"""End-to-end: feed -> fetch -> scan -> score -> ClickHouse.

Nothing here executes package code. Downloads land in a sandbox directory,
are read as bytes, analysed statically, and deleted.
"""

from __future__ import annotations

import asyncio
import os
import shutil
import stat
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import httpx

from . import feeds
from .config import settings
from .fetch import UnsafeArchive, download, extract
from .feeds import Release
from .scan import Finding, scan
from .score import Verdict, assess
from .signals import Signal, metadata_signals
from .store import ClickHouse


@dataclass
class Result:
    release: Release
    verdict: Verdict
    findings: list[Finding]
    signals: list[Signal]
    scan_ms: int
    latency_ms: int
    file_count: int
    unpacked_bytes: int
    sha256: str
    error: str = ""


def _force_rm(path: Path) -> None:
    def on_error(func, target, _exc):  # noqa: ANN001
        try:
            os.chmod(target, stat.S_IWRITE)
            func(target)
        except OSError:
            pass

    shutil.rmtree(path, onerror=on_error)


class Pipeline:
    def __init__(self, store: ClickHouse) -> None:
        self.store = store
        self.client = httpx.AsyncClient(
            headers={"user-agent": settings.user_agent},
            timeout=httpx.Timeout(60.0),
            follow_redirects=True,
        )
        self.semaphore = asyncio.Semaphore(settings.concurrency)
        settings.sandbox_dir.mkdir(parents=True, exist_ok=True)

    async def aclose(self) -> None:
        await self.client.aclose()

    # ---------------------------------------------------------------- scan

    async def process(self, release: Release) -> Result:
        async with self.semaphore:
            return await self._process(release)

    async def _process(self, release: Release) -> Result:
        started = time.perf_counter()
        workdir = settings.sandbox_dir / f"{release.ecosystem}-{uuid.uuid4().hex[:12]}"
        findings: list[Finding] = []
        file_count = 0
        unpacked = 0
        digest = ""
        error = ""

        try:
            blob = await download(release.tarball_url, self.client)
            extracted = await asyncio.to_thread(extract, blob, workdir)
            file_count = extracted.file_count
            unpacked = extracted.unpacked_bytes
            digest = extracted.sha256
            findings = await asyncio.to_thread(scan, workdir, release.ecosystem)
        except UnsafeArchive as exc:
            error = f"unsafe-archive: {exc}"
            findings.append(
                Finding(
                    rule_id="bb-heur-unsafe-archive",
                    engine="heuristic",
                    severity="error",
                    weight=40,
                    file="<archive>",
                    line=0,
                    end_line=0,
                    snippet="",
                    message=str(exc),
                    mitre=["T1027"],
                )
            )
        except (httpx.HTTPError, OSError, ValueError) as exc:
            error = f"{type(exc).__name__}: {exc}"
        finally:
            if workdir.exists():
                await asyncio.to_thread(_force_rm, workdir)

        signals = metadata_signals(release)
        verdict = assess(findings, signals)

        # Publisher details cost an extra request, so only pay for it when the
        # package is actually interesting.
        if verdict.verdict != "clean" and release.ecosystem == "npm":
            release = await feeds.npm_enrich(self.client, release)
            signals = metadata_signals(release)
            verdict = assess(findings, signals)

        scan_ms = int((time.perf_counter() - started) * 1000)
        now = datetime.now(timezone.utc)
        published = release.published_at
        if published.tzinfo is None:
            published = published.replace(tzinfo=timezone.utc)
        latency_ms = max(0, int((now - published).total_seconds() * 1000))

        return Result(
            release=release,
            verdict=verdict,
            findings=findings,
            signals=signals,
            scan_ms=scan_ms,
            latency_ms=latency_ms,
            file_count=file_count,
            unpacked_bytes=unpacked,
            sha256=digest,
            error=error,
        )

    # --------------------------------------------------------------- write

    async def persist(self, result: Result) -> None:
        release = result.release
        verdict = result.verdict
        scanned_at = datetime.now(timezone.utc).isoformat()

        await self.store.insert(
            "releases",
            [
                {
                    "scannedAt": scanned_at,
                    "publishedAt": release.published_at.isoformat(),
                    "ecosystem": release.ecosystem,
                    "package": release.package,
                    "version": release.version,
                    "publisher": release.publisher,
                    "publisherEmail": release.publisher_email,
                    "repository": release.repository,
                    "fileCount": result.file_count,
                    "unpackedBytes": result.unpacked_bytes,
                    "hasInstallScript": int(
                        bool(release.has_install_script or release.install_scripts)
                    ),
                    "score": verdict.score,
                    "verdict": verdict.verdict,
                    "ruleIds": verdict.rule_ids,
                    "signalIds": verdict.signal_ids,
                    "scanMillis": result.scan_ms,
                    "latencyMillis": result.latency_ms,
                    "tarballUrl": release.tarball_url,
                    "sha256": result.sha256,
                }
            ],
        )

        if result.findings:
            await self.store.insert(
                "findings",
                [
                    {
                        "scannedAt": scanned_at,
                        "ecosystem": release.ecosystem,
                        "package": release.package,
                        "version": release.version,
                        "ruleId": f.rule_id,
                        "engine": f.engine,
                        "severity": f.severity,
                        "weight": f.weight,
                        "file": f.file,
                        "line": f.line,
                        "endLine": f.end_line,
                        "snippet": f.snippet,
                        "message": f.message,
                    }
                    for f in result.findings
                ],
            )

        logs = [
            {
                "eventTime": scanned_at,
                "sourceType": release.ecosystem,
                "eventName": "release",
                "package": release.package,
                "version": release.version,
                "publisher": release.publisher,
                "ruleId": "",
                "severity": verdict.severity,
                "file": "",
                "line": 0,
                "score": verdict.score,
                "rawLog": verdict.summary,
            }
        ]
        logs += [
            {
                "eventTime": scanned_at,
                "sourceType": release.ecosystem,
                "eventName": "finding",
                "package": release.package,
                "version": release.version,
                "publisher": release.publisher,
                "ruleId": f.rule_id,
                "severity": f.severity,
                "file": f.file,
                "line": f.line,
                "score": f.weight,
                "rawLog": f.message,
            }
            for f in result.findings
        ]
        await self.store.insert("logs", logs)

        if verdict.verdict != "clean":
            await self.store.insert(
                "detections",
                [
                    {
                        "detectedAt": scanned_at,
                        "ecosystem": release.ecosystem,
                        "package": release.package,
                        "version": release.version,
                        "publisher": release.publisher,
                        "score": verdict.score,
                        "severity": verdict.severity,
                        "verdict": verdict.verdict,
                        "ruleIds": verdict.rule_ids,
                        "signalIds": verdict.signal_ids,
                        "mitreAttacks": verdict.mitre,
                        "summary": verdict.summary,
                        # Filled in by the Guild agent when it notifies.
                        "notificationNames": [],
                        "agentVerdict": "",
                        "agentActions": [],
                        "tarballUrl": release.tarball_url,
                    }
                ],
            )

    # ---------------------------------------------------------------- feeds

    @staticmethod
    def _collected(results: list[object]) -> list[Release]:
        return [r for r in results if isinstance(r, Release)]

    async def collect_npm(self, since: int, limit: int) -> tuple[list[Release], int]:
        try:
            names, last_seq = await feeds.npm_changes(self.client, since, limit)
        except (httpx.HTTPError, ValueError):
            return [], since
        unique = list(dict.fromkeys(names))[:limit]
        results = await asyncio.gather(
            *(feeds.npm_latest_release(self.client, name) for name in unique),
            return_exceptions=True,
        )
        return self._collected(list(results)), last_seq

    async def collect_pypi(self, seen_keys: set[str], limit: int = 20) -> list[Release]:
        """Metadata lookups run concurrently and the batch is capped.

        Fetching all ~100 RSS entries one at a time took longer than the whole
        poll interval, so the scanner never got round to actually scanning
        anything.
        """
        try:
            recent = await feeds.pypi_recent(self.client)
        except (httpx.HTTPError, ValueError):
            return []
        pending = [
            (name, version)
            for name, version in recent
            if f"pypi:{name}@{version}" not in seen_keys
        ][:limit]
        results = await asyncio.gather(
            *(feeds.pypi_release(self.client, name, version) for name, version in pending),
            return_exceptions=True,
        )
        return self._collected(list(results))
