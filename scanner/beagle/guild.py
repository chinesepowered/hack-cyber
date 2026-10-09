"""Guild.ai triage agent.

A detection is evidence, not a decision. The scanner produces rule hits and a
score; this hands that evidence to an agent hosted on Guild, which returns the
judgement a human on-call engineer actually needs: verdict, reasoning tied to
specific lines, recommended actions, and a confidence with its own caveat.

The agent runs on Guild, not here. We start a session through the Guild API,
poll for the reply, parse it and write it back onto the detection row, which
is what the dashboard renders.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
from dataclasses import dataclass, field
from typing import Any

import httpx

from . import config as _config  # noqa: F401  (imported for its .env side effect)

GUILD_API = "https://api.guild.ai/v1"

AGENT_ID = os.getenv("GUILD_AGENT_ID", "01a12261-d87f-726e-0000-3a82251310a9")
WORKSPACE_ID = os.getenv("GUILD_WORKSPACE_ID", "019dc0bb-6409-3bb9-0000-0a29b679dd59")

SECTION = re.compile(
    r"\*{0,2}(VERDICT|WHY|ACTIONS|CONFIDENCE)\*{0,2}\s*[:\-]?\s*",
    re.IGNORECASE,
)


class GuildError(RuntimeError):
    pass


@dataclass
class Triage:
    verdict: str = ""
    why: list[str] = field(default_factory=list)
    actions: list[str] = field(default_factory=list)
    confidence: str = ""
    raw: str = ""

    @property
    def summary(self) -> str:
        """One-line verdict plus confidence, for the detection row."""
        head = self.verdict.strip()
        if self.confidence:
            head = f"{head} (confidence: {self.confidence.strip()})"
        return head[:1000]


def _auth() -> tuple[str, str]:
    key = os.getenv("GUILD_API_KEY", "")
    if ":" not in key:
        raise GuildError("GUILD_API_KEY must be '<key_id>:<secret>'")
    key_id, secret = key.split(":", 1)
    return key_id, secret


def _bullets(block: str) -> list[str]:
    out: list[str] = []
    for line in block.splitlines():
        line = line.strip()
        if not line:
            continue
        line = re.sub(r"^[-*•]\s*", "", line)
        line = re.sub(r"^\d+[.)]\s*", "", line)
        if line:
            out.append(line[:400])
    return out[:6]


def parse_triage(text: str) -> Triage:
    """Split the agent's four-section reply into fields."""
    triage = Triage(raw=text)
    parts = SECTION.split(text)
    # split() yields [preamble, NAME, body, NAME, body, ...]
    for index in range(1, len(parts) - 1, 2):
        name = parts[index].upper()
        body = parts[index + 1].strip()
        if name == "VERDICT":
            triage.verdict = " ".join(body.split())[:300]
        elif name == "WHY":
            triage.why = _bullets(body)
        elif name == "ACTIONS":
            triage.actions = _bullets(body)
        elif name == "CONFIDENCE":
            triage.confidence = " ".join(body.split())[:300]
    if not triage.verdict:
        triage.verdict = " ".join(text.split())[:300]
    return triage


def build_prompt(detection: dict[str, Any], findings: list[dict[str, Any]]) -> str:
    payload = {
        "ecosystem": detection.get("ecosystem"),
        "package": detection.get("package"),
        "version": detection.get("version"),
        "score": detection.get("score"),
        "scannerVerdict": detection.get("verdict"),
        "rulesFired": detection.get("ruleIds"),
        "metadataSignals": detection.get("signalIds"),
        "mitre": detection.get("mitreAttacks"),
        "evidence": [
            {
                "rule": f.get("ruleId"),
                "file": f.get("file"),
                "line": f.get("line"),
                "code": (f.get("snippet") or "")[:600],
                "why": f.get("message"),
            }
            for f in findings[:10]
        ],
    }
    return "Triage this detection:\n\n```json\n" + json.dumps(payload, indent=2) + "\n```"


async def run_triage(
    client: httpx.AsyncClient,
    detection: dict[str, Any],
    findings: list[dict[str, Any]],
    *,
    timeout_s: int = 420,
) -> Triage:
    auth = _auth()
    prompt = build_prompt(detection, findings)

    response = await client.post(
        f"{GUILD_API}/workspaces/{WORKSPACE_ID}/sessions",
        auth=auth,
        json={"session_type": "chat", "agent_id": AGENT_ID, "initial_prompt": prompt},
        timeout=60.0,
    )
    if response.status_code >= 400:
        raise GuildError(f"start session {response.status_code}: {response.text[:300]}")
    session_id = response.json().get("id")
    if not session_id:
        raise GuildError("no session id returned")

    deadline = asyncio.get_running_loop().time() + timeout_s
    while asyncio.get_running_loop().time() < deadline:
        await asyncio.sleep(4.0)
        # The event list embeds raw LLM request and response payloads, so it
        # grows to megabytes and a poll can time out. A slow poll is not a
        # failed triage: keep polling until the deadline.
        try:
            events = await client.get(
                f"{GUILD_API}/sessions/{session_id}/events",
                auth=auth,
                params={"limit": 100},
                timeout=90.0,
            )
        except httpx.HTTPError:
            continue
        if events.status_code >= 400:
            continue
        try:
            payload = events.json()
        except ValueError:
            continue
        text = _latest_agent_text(payload)
        if text:
            return parse_triage(text)

    raise GuildError(f"agent did not reply within {timeout_s}s (session {session_id})")


def _latest_agent_text(payload: dict[str, Any]) -> str:
    """Pull the agent's final message out of the session event list.

    A Guild session event list interleaves the user message, runtime and LLM
    plumbing, streaming deltas and the finished reply. The completed answer
    arrives as an `agent_notification_message` whose content carries `data`,
    with `runtime_done`'s `content.text` as a fallback. Both are skipped while
    `is_delta` is set, otherwise we would parse a half-written sentence.

    Matching loosely here is how the first version ended up parsing our own
    prompt back out, because the JSON we send contains the word "verdict".
    """
    items = payload.get("items") or payload.get("events") or []
    best = ""

    for item in items:
        event_type = str(item.get("type") or "")
        if event_type == "user_message":
            continue
        content = item.get("content")
        if not isinstance(content, dict) or content.get("is_delta"):
            continue

        text = ""
        if event_type == "agent_notification_message":
            text = content.get("data") or ""
        elif event_type == "runtime_done":
            text = content.get("text") or ""
        elif event_type == "runtime_start":
            message = content.get("message")
            if isinstance(message, dict):
                text = message.get("text") or ""

        # Events arrive oldest first, so a later complete reply wins.
        if isinstance(text, str) and len(text) >= len(best):
            best = text

    return best if "VERDICT" in best.upper() else ""
