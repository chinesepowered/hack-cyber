"""Command line entry point.

    beagle init-db                     apply schema.sql
    beagle scan-one npm <pkg> [ver]    fetch, scan and score one package
    beagle live --duration 300         tail npm + PyPI and scan continuously
    beagle backfill --target 2000000   bulk-load real registry history
    beagle replay                      scan the local detection fixtures
    beagle stats                       print the counters the dashboard shows
"""

from __future__ import annotations

import argparse
import json
import asyncio
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx
from rich.console import Console
from rich.table import Table

from . import feeds
from .backfill import backfill_npm
from .config import REPO_ROOT, settings
from .feeds import Release
from .pipeline import Pipeline, Result
from .store import ClickHouse

console = Console()

VERDICT_STYLE = {
    "malicious": "bold white on red",
    "suspicious": "bold black on yellow",
    "clean": "dim",
}


def _line(result: Result) -> None:
    release = result.release
    verdict = result.verdict
    style = VERDICT_STYLE.get(verdict.verdict, "")
    marker = {"malicious": "BARK", "suspicious": "sniff", "clean": "ok"}[verdict.verdict]
    console.print(
        f"[{style}] {marker:>5} [/] "
        f"{release.ecosystem}:{release.package}@{release.version} "
        f"score={verdict.score:>3} "
        f"files={result.file_count:<4} "
        f"scan={result.scan_ms}ms"
        + (f"  [dim]{verdict.summary}[/dim]" if verdict.verdict != "clean" else "")
    )


async def cmd_init_db(_: argparse.Namespace) -> int:
    async with ClickHouse() as store:
        applied = await store.apply_schema(REPO_ROOT / "scanner" / "schema.sql")
    console.print(f"[green]applied {len(applied)} statements[/green]")
    for statement in applied:
        console.print(f"  [dim]{statement}[/dim]")
    return 0


async def cmd_scan_one(args: argparse.Namespace) -> int:
    async with ClickHouse() as store:
        pipeline = Pipeline(store)
        try:
            if args.ecosystem == "npm":
                release = await feeds.npm_latest_release(pipeline.client, args.package)
                if release and args.version:
                    release.version = args.version
            else:
                version = args.version
                if not version:
                    doc = await pipeline.client.get(
                        f"https://pypi.org/pypi/{args.package}/json", timeout=30.0
                    )
                    version = doc.json()["info"]["version"]
                release = await feeds.pypi_release(pipeline.client, args.package, version)

            if not release:
                console.print("[red]package not found[/red]")
                return 1

            result = await pipeline.process(release)
            _line(result)
            if result.error:
                console.print(f"[yellow]note: {result.error}[/yellow]")

            if result.findings:
                table = Table("rule", "engine", "file", "line", "message", box=None)
                for finding in sorted(result.findings, key=lambda f: -f.weight)[:20]:
                    table.add_row(
                        finding.rule_id,
                        finding.engine,
                        finding.file[:44],
                        str(finding.line),
                        finding.message[:70],
                    )
                console.print(table)
            for signal in result.signals:
                console.print(f"  [cyan]signal[/cyan] {signal.signal_id}: {signal.detail}")

            if not args.dry_run:
                await pipeline.persist(result)
                console.print("[dim]written to ClickHouse[/dim]")
        finally:
            await pipeline.aclose()
    return 0


async def cmd_live(args: argparse.Namespace) -> int:
    deadline = time.perf_counter() + args.duration
    seen: set[str] = set()
    scanned = flagged = 0

    async with ClickHouse() as store:
        pipeline = Pipeline(store)
        try:
            seq = await feeds.npm_current_seq(pipeline.client)
            console.print(
                f"[bold]Beagle Brigade[/bold] tailing from npm seq {seq:,} "
                f"for {args.duration}s (concurrency {settings.concurrency})"
            )

            while time.perf_counter() < deadline:
                batch: list[Release] = []

                if args.ecosystem in ("both", "npm"):
                    releases, seq = await pipeline.collect_npm(seq, args.batch)
                    batch += releases
                if args.ecosystem in ("both", "pypi"):
                    batch += await pipeline.collect_pypi(seen, args.batch)

                batch = [r for r in batch if r.key not in seen]
                for release in batch:
                    seen.add(release.key)

                if not batch:
                    await asyncio.sleep(3.0)
                    continue

                results = await asyncio.gather(
                    *(pipeline.process(r) for r in batch), return_exceptions=True
                )
                for result in results:
                    if isinstance(result, BaseException):
                        continue
                    scanned += 1
                    if result.verdict.verdict != "clean":
                        flagged += 1
                    _line(result)
                    await pipeline.persist(result)

                await asyncio.sleep(1.0)
        except KeyboardInterrupt:
            console.print("\n[dim]stopped[/dim]")
        finally:
            await pipeline.aclose()

    console.print(f"\n[bold]scanned {scanned}, flagged {flagged}[/bold]")
    return 0


async def cmd_backfill(args: argparse.Namespace) -> int:
    async with ClickHouse() as store:
        console.print(
            f"[bold]backfilling[/bold] npm registry history, "
            f"target {args.target:,} rows, {args.workers} workers"
        )
        progress = await backfill_npm(
            store, target_rows=args.target, batch=args.batch, workers=args.workers
        )
        console.print(
            f"[green]loaded {progress.rows:,} rows[/green] "
            f"in {progress.requests:,} requests "
            f"({progress.rate:,.0f} rows/sec)"
        )
        total = await store.query("SELECT count() AS c FROM registry_history")
        console.print(f"registry_history now holds [bold]{int(total[0]['c']):,}[/bold] rows")
    return 0


async def cmd_replay(args: argparse.Namespace) -> int:
    """Scan the local fixture packages. Used for a deterministic demo."""
    fixtures = REPO_ROOT / "scanner" / "fixtures"
    if not fixtures.exists():
        console.print(f"[red]no fixtures at {fixtures}[/red]")
        return 1

    from .scan import scan
    from .score import assess
    from .signals import metadata_signals

    async with ClickHouse() as store:
        pipeline = Pipeline(store)
        try:
            for case in sorted(p for p in fixtures.iterdir() if p.is_dir()):
                ecosystem = "pypi" if (case / "setup.py").exists() else "npm"
                started = time.perf_counter()
                findings = await asyncio.to_thread(scan, case, ecosystem)

                # Read the fixture's own manifest so metadata signals see what
                # they would see for a real release (name, version, repo).
                name, version, repository, has_hook = case.name, "0.0.0-fixture", "", False
                manifest = case / "package.json"
                if manifest.exists():
                    try:
                        doc = json.loads(manifest.read_text(encoding="utf-8"))
                        name = doc.get("name", name)
                        version = doc.get("version", version)
                        repo = doc.get("repository") or {}
                        repository = repo.get("url", "") if isinstance(repo, dict) else str(repo)
                        has_hook = bool(doc.get("scripts"))
                    except ValueError:
                        pass

                release = Release(
                    ecosystem=ecosystem,
                    package=name,
                    version=version,
                    published_at=datetime.now(timezone.utc),
                    tarball_url=f"fixture://{case.name}",
                    repository=repository,
                    has_install_script=has_hook or ecosystem == "pypi",
                )
                signals = metadata_signals(release)
                verdict = assess(findings, signals)
                result = Result(
                    release=release,
                    verdict=verdict,
                    findings=findings,
                    signals=signals,
                    scan_ms=int((time.perf_counter() - started) * 1000),
                    latency_ms=0,
                    file_count=sum(1 for _ in case.rglob("*") if _.is_file()),
                    unpacked_bytes=sum(p.stat().st_size for p in case.rglob("*") if p.is_file()),
                    sha256="fixture",
                )
                _line(result)
                for finding in sorted(findings, key=lambda f: -f.weight)[:6]:
                    console.print(
                        f"    [dim]{finding.rule_id}[/dim] {finding.file}:{finding.line}"
                    )
                if not args.dry_run:
                    await pipeline.persist(result)
        finally:
            await pipeline.aclose()
    return 0


async def cmd_triage(args: argparse.Namespace) -> int:
    """Hand untriaged detections to the Guild agent and store its judgement."""
    from . import guild

    async with ClickHouse() as store:
        pending = await store.query(
            """
            SELECT * FROM detections
            WHERE agentVerdict = '' AND verdict != 'clean'
            ORDER BY detectedAt DESC
            LIMIT {limit:UInt32}
            """,
            {"limit": args.limit},
        )
        if not pending:
            console.print("[dim]nothing waiting for triage[/dim]")
            return 0

        console.print(f"[bold]triaging {len(pending)} detection(s) on Guild[/bold]")
        async with httpx.AsyncClient() as client:
            for detection in pending:
                package = detection["package"]
                version = detection["version"]
                findings = await store.query(
                    """
                    SELECT ruleId, file, line, snippet, message
                    FROM findings
                    WHERE package = {pkg:String} AND version = {ver:String}
                    ORDER BY weight DESC LIMIT 10
                    """,
                    {"pkg": package, "ver": version},
                )
                try:
                    triage = await guild.run_triage(client, detection, findings)
                except guild.GuildError as exc:
                    console.print(f"  [red]{package}@{version}: {exc}[/red]")
                    continue

                verdict_text = triage.summary
                if triage.why:
                    verdict_text = f"{verdict_text} {' '.join(triage.why)}"

                await store.execute(
                    """
                    ALTER TABLE detections
                    UPDATE agentVerdict = {verdict:String},
                           agentActions = {actions:Array(String)},
                           notificationNames = {channels:Array(String)}
                    WHERE package = {pkg:String} AND version = {ver:String}
                    """,
                    params={
                        "verdict": verdict_text[:2000],
                        "actions": triage.actions,
                        "channels": ["dashboard"],
                        "pkg": package,
                        "ver": version,
                    },
                )
                console.print(f"  [green]{package}@{version}[/green] {triage.verdict[:90]}")
                for action in triage.actions[:3]:
                    console.print(f"      [dim]{action[:100]}[/dim]")
    return 0


async def cmd_reset(args: argparse.Namespace) -> int:
    """Clear scan results for a clean demo. Registry history is kept unless
    --all is passed, because reloading millions of rows takes minutes."""
    tables = ["releases", "findings", "detections", "logs"]
    if args.all:
        tables.append("registry_history")
    async with ClickHouse() as store:
        for table in tables:
            await store.execute(f"TRUNCATE TABLE IF EXISTS {table}")
            console.print(f"  [dim]truncated {table}[/dim]")
    console.print("[green]demo data reset[/green]")
    return 0


async def cmd_stats(_: argparse.Namespace) -> int:
    async with ClickHouse() as store:
        queries = {
            "releases scanned": "SELECT count() AS v FROM releases",
            "flagged": "SELECT countIf(verdict != 'clean') AS v FROM releases",
            "malicious": "SELECT countIf(verdict = 'malicious') AS v FROM releases",
            "findings": "SELECT count() AS v FROM findings",
            "detections": "SELECT count() AS v FROM detections",
            "registry history rows": "SELECT count() AS v FROM registry_history",
            "log events": "SELECT count() AS v FROM logs",
        }
        table = Table("metric", "value", "query ms", box=None)
        for label, sql in queries.items():
            started = time.perf_counter()
            rows = await store.query(sql)
            elapsed = (time.perf_counter() - started) * 1000
            table.add_row(label, f"{int(rows[0]['v']):,}", f"{elapsed:.0f}")
        console.print(table)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="beagle", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("init-db").set_defaults(fn=cmd_init_db)

    scan_one = sub.add_parser("scan-one")
    scan_one.add_argument("ecosystem", choices=["npm", "pypi"])
    scan_one.add_argument("package")
    scan_one.add_argument("version", nargs="?")
    scan_one.add_argument("--dry-run", action="store_true")
    scan_one.set_defaults(fn=cmd_scan_one)

    live = sub.add_parser("live")
    live.add_argument("--duration", type=int, default=300)
    live.add_argument("--batch", type=int, default=40)
    live.add_argument("--ecosystem", choices=["both", "npm", "pypi"], default="both")
    live.set_defaults(fn=cmd_live)

    backfill = sub.add_parser("backfill")
    backfill.add_argument("--target", type=int, default=1_000_000)
    backfill.add_argument("--batch", type=int, default=5000)
    backfill.add_argument("--workers", type=int, default=8)
    backfill.set_defaults(fn=cmd_backfill)

    replay = sub.add_parser("replay")
    replay.add_argument("--dry-run", action="store_true")
    replay.set_defaults(fn=cmd_replay)

    triage = sub.add_parser("triage")
    triage.add_argument("--limit", type=int, default=5)
    triage.set_defaults(fn=cmd_triage)

    reset = sub.add_parser("reset")
    reset.add_argument("--all", action="store_true", help="also drop registry history")
    reset.set_defaults(fn=cmd_reset)

    sub.add_parser("stats").set_defaults(fn=cmd_stats)

    args = parser.parse_args(argv)
    try:
        return asyncio.run(args.fn(args))
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
