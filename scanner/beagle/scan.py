"""Static analysis of an extracted package.

Two engines:
  * Semgrep, for anything that needs real parsing or dataflow
  * cheap text heuristics, for things Semgrep is a poor fit for
    (entropy blobs, invisible Unicode, minified bundles)

Findings carry an `install_context` flag. A network call in a test file is
noise; the same call in a postinstall hook is the whole ballgame. Rules that
set `metadata.install_context: true` are *only* kept when they land in a file
that actually runs during installation, resolved from package.json scripts or
setup.py. Without that gate, scanning express produced dozens of hits.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from .config import settings

SEMGREP = shutil.which("semgrep") or shutil.which("semgrep.exe")

# Bidirectional override and isolate characters: the "Trojan Source" class,
# where the code a reviewer sees is not the code the parser sees.
#
# Deliberately narrow. An earlier version also matched BOM (U+FEFF) and the
# zero-width range, which flagged real packages whose crime was handling a BOM
# correctly (`text.replace(/^﻿/, "")`). These overrides have no honest
# use in source.
INVISIBLE = re.compile(r"[‪-‮⁦-⁩]")
BASE64_RUN = re.compile(r"[A-Za-z0-9+/=]{200,}")
HEX_RUN = re.compile(r"(?:\\x[0-9a-fA-F]{2}){40,}")

CODE_SUFFIXES = {".js", ".cjs", ".mjs", ".ts", ".jsx", ".tsx", ".py"}
INSTALL_HOOK_KEYS = ("preinstall", "install", "postinstall", "prepare")


@dataclass
class Finding:
    rule_id: str
    engine: str
    severity: str
    weight: int
    file: str
    line: int
    end_line: int
    snippet: str
    message: str
    install_context: bool = False
    requires_install_context: bool = False
    mitre: list[str] = field(default_factory=list)


def _rel(path: Path, root: Path) -> str:
    try:
        return str(path.relative_to(root)).replace("\\", "/")
    except ValueError:
        return str(path).replace("\\", "/")


def install_context_files(root: Path, ecosystem: str) -> set[str]:
    """Files that execute during installation."""
    marked: set[str] = set()
    if ecosystem == "npm":
        for pkg_json in root.rglob("package.json"):
            try:
                doc = json.loads(pkg_json.read_text(encoding="utf-8", errors="replace"))
            except (ValueError, OSError):
                continue
            scripts = doc.get("scripts") or {}
            for key in INSTALL_HOOK_KEYS:
                command = scripts.get(key)
                if not isinstance(command, str):
                    continue
                marked.add(_rel(pkg_json, root))
                for token in re.findall(r"[\w./\\-]+\.(?:js|cjs|mjs|py|sh)", command):
                    candidate = pkg_json.parent / token
                    if candidate.exists():
                        marked.add(_rel(candidate, root))
        for name in ("install.js", "postinstall.js", "preinstall.js"):
            for hit in root.rglob(name):
                marked.add(_rel(hit, root))
    else:
        for name in ("setup.py", "conftest.py"):
            for hit in root.rglob(name):
                marked.add(_rel(hit, root))
    return marked


def read_snippet(path: Path, start: int, end: int, context: int = 1) -> str:
    """Pull the matched lines straight off disk.

    Semgrep's OSS JSON puts the literal string "requires login" in
    `extra.lines`, so the evidence panel would show that instead of code. We
    have the file right here, so read it.
    """
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return ""
    if start <= 0:
        return ""
    first = max(0, start - 1 - context)
    last = min(len(lines), max(end, start) + context)
    return "\n".join(lines[first:last])[:800]


def run_semgrep(root: Path) -> list[Finding]:
    if not SEMGREP:
        return []
    env = dict(os.environ)
    # Keep Semgrep's state inside the sandbox: avoids the home-directory
    # settings file being locked by a parallel run.
    # Unique per scan, and always inside the sandbox directory. A shared
    # settings path makes concurrent Semgrep processes race on the same file
    # and fail with PermissionError; deriving it from `root` instead would
    # scatter dotfiles next to whatever is being scanned, including the
    # in-repo fixtures.
    settings.sandbox_dir.mkdir(parents=True, exist_ok=True)
    env["SEMGREP_SETTINGS_FILE"] = str(settings.sandbox_dir / f".semgrep-{root.name}.yml")
    cmd = [
        SEMGREP,
        "--config",
        str(settings.rules_dir),
        "--json",
        "--quiet",
        "--no-git-ignore",
        "--disable-version-check",
        "--metrics=off",
        "--timeout",
        str(settings.semgrep_timeout_s),
        # Vendored and minified trees dominate scan time and almost never
        # carry the install-time behaviour we care about.
        "--exclude",
        "node_modules",
        "--exclude",
        "*.min.js",
        "--exclude",
        "*.map",
        "--exclude",
        "test",
        "--exclude",
        "tests",
        "--exclude",
        "__tests__",
        "--max-target-bytes",
        str(settings.max_file_bytes),
        str(root),
    ]
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=settings.semgrep_timeout_s + 30,
            env=env,
        )
    except subprocess.TimeoutExpired:
        return []
    if not proc.stdout.strip():
        return []
    try:
        payload = json.loads(proc.stdout)
    except ValueError:
        return []

    findings: list[Finding] = []
    for result in payload.get("results", []):
        extra = result.get("extra") or {}
        meta = extra.get("metadata") or {}
        hit_path = Path(result.get("path", ""))
        start_line = int((result.get("start") or {}).get("line", 0))
        end_line = int((result.get("end") or {}).get("line", 0))
        reported = str(extra.get("lines") or "")
        snippet = (
            read_snippet(hit_path, start_line, end_line)
            if (not reported or "requires login" in reported.lower())
            else reported[:800]
        )
        findings.append(
            Finding(
                rule_id=str(result.get("check_id", "")).split(".")[-1],
                engine="semgrep",
                severity=str(extra.get("severity", "INFO")).lower(),
                weight=int(meta.get("weight", 10)),
                file=_rel(hit_path, root),
                line=start_line,
                end_line=end_line,
                snippet=snippet,
                message=" ".join(str(extra.get("message", "")).split())[:500],
                requires_install_context=bool(meta.get("install_context")),
                mitre=list(meta.get("mitre") or []),
            )
        )
    return findings


def run_heuristics(root: Path, ecosystem: str) -> list[Finding]:
    findings: list[Finding] = []

    if ecosystem == "npm":
        for pkg_json in root.rglob("package.json"):
            try:
                doc = json.loads(pkg_json.read_text(encoding="utf-8", errors="replace"))
            except (ValueError, OSError):
                continue
            scripts = doc.get("scripts") or {}
            for key in INSTALL_HOOK_KEYS:
                if isinstance(scripts.get(key), str):
                    findings.append(
                        Finding(
                            rule_id="bb-meta-install-hook",
                            engine="heuristic",
                            severity="info",
                            weight=8,
                            file=_rel(pkg_json, root),
                            line=0,
                            end_line=0,
                            snippet=f'"{key}": {scripts[key][:200]!r}',
                            message=f"package.json declares a {key} hook",
                            install_context=True,
                            mitre=["T1546"],
                        )
                    )

    for path in root.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in CODE_SUFFIXES:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        if len(text) > settings.max_file_bytes:
            continue
        rel = _rel(path, root)

        match = INVISIBLE.search(text)
        if match:
            line = text.count("\n", 0, match.start()) + 1
            findings.append(
                Finding(
                    rule_id="bb-heur-invisible-unicode",
                    engine="heuristic",
                    severity="error",
                    weight=35,
                    file=rel,
                    line=line,
                    end_line=line,
                    snippet=repr(text[max(0, match.start() - 60) : match.start() + 60])[:400],
                    message="Invisible or bidirectional Unicode hides code from review",
                    mitre=["T1027"],
                )
            )

        blob = BASE64_RUN.search(text) or HEX_RUN.search(text)
        if blob:
            line = text.count("\n", 0, blob.start()) + 1
            findings.append(
                Finding(
                    rule_id="bb-heur-encoded-blob",
                    engine="heuristic",
                    severity="warning",
                    weight=18,
                    file=rel,
                    line=line,
                    end_line=line,
                    snippet=blob.group(0)[:120] + "...",
                    message=f"Long encoded blob ({len(blob.group(0))} chars) embedded in source",
                    mitre=["T1027"],
                )
            )

        lines = text.split("\n")
        if lines and max(len(ln) for ln in lines) > 5000 and len(lines) < 50:
            findings.append(
                Finding(
                    rule_id="bb-heur-minified-source",
                    engine="heuristic",
                    severity="info",
                    weight=5,
                    file=rel,
                    line=1,
                    end_line=1,
                    snippet=lines[0][:120] + "...",
                    message="Minified or bundled source shipped without a readable original",
                    mitre=[],
                )
            )

    return findings


def scan(root: Path, ecosystem: str) -> list[Finding]:
    marked = install_context_files(root, ecosystem)
    findings = run_semgrep(root) + run_heuristics(root, ecosystem)

    kept: list[Finding] = []
    for finding in findings:
        in_context = finding.install_context or finding.file in marked
        if finding.requires_install_context and not in_context:
            # Ordinary application code, not an install hook. Drop it.
            continue
        finding.install_context = in_context
        kept.append(finding)
    return kept
