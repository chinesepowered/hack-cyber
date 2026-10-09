"""Bulk-load real npm registry change history into ClickHouse.

This is the scale layer. Each change row is tiny (sequence, package, revision)
and the replication feed serves thousands per request, so a few parallel
workers walking disjoint slices of the sequence space move millions of real
registry events in minutes.

The history is not decoration: publisher release cadence and a package's
revision count are baselines the scorer and the dashboard query against.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass

import httpx

from .config import settings
from .feeds import NPM_REPLICATE, npm_current_seq
from .store import ClickHouse


@dataclass
class Progress:
    rows: int = 0
    requests: int = 0
    started: float = 0.0

    @property
    def rate(self) -> float:
        elapsed = max(1e-6, time.perf_counter() - self.started)
        return self.rows / elapsed


async def _worker(
    client: httpx.AsyncClient,
    store: ClickHouse,
    start: int,
    end: int,
    batch: int,
    progress: Progress,
    stop: asyncio.Event,
) -> None:
    since = start
    while since < end and not stop.is_set():
        try:
            response = await client.get(
                NPM_REPLICATE + "/_changes",
                params={"since": since, "limit": batch},
                headers={"user-agent": settings.user_agent},
                timeout=90.0,
            )
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError):
            await asyncio.sleep(2.0)
            continue

        results = payload.get("results") or []
        if not results:
            return

        rows = []
        for row in results:
            seq = int(row.get("seq", 0))
            if seq > end:
                break
            changes = row.get("changes") or [{}]
            rows.append(
                {
                    "seq": seq,
                    "ecosystem": "npm",
                    "package": row.get("id", ""),
                    "rev": changes[0].get("rev", ""),
                    "deleted": int(bool(row.get("deleted"))),
                }
            )

        if rows:
            await store.insert("registry_history", rows)
            progress.rows += len(rows)
        progress.requests += 1

        last_seq = int(payload.get("last_seq", since))
        if last_seq <= since:
            return
        since = last_seq


async def backfill_npm(
    store: ClickHouse,
    target_rows: int,
    batch: int = 5000,
    workers: int = 8,
) -> Progress:
    progress = Progress(started=time.perf_counter())
    stop = asyncio.Event()

    async with httpx.AsyncClient(follow_redirects=True) as client:
        head = await npm_current_seq(client)
        # Disjoint slices so workers never fetch the same sequence twice.
        span = head // workers
        tasks = [
            asyncio.create_task(
                _worker(
                    client,
                    store,
                    start=i * span,
                    end=(i + 1) * span if i < workers - 1 else head,
                    batch=batch,
                    progress=progress,
                    stop=stop,
                )
            )
            for i in range(workers)
        ]

        try:
            while not all(task.done() for task in tasks):
                await asyncio.sleep(0.5)
                if progress.rows >= target_rows:
                    stop.set()
                    break
        finally:
            stop.set()
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)

    return progress
