"""Find invisible and bidi control characters in tracked text files.

Run before committing. With --fix, rewrites each as its ASCII backslash-u
escape, so the source reads the same to a reviewer as it does to the parser.
See docs/semgrep-guardian-finding.md for why this exists.
"""
import subprocess, sys
from pathlib import Path

BAD = {cp: chr(92) + f"u{cp:04x}" for cp in [*range(0x202A, 0x202F), *range(0x2066, 0x206A), *range(0x200B, 0x2010), 0xFEFF]}
files = subprocess.run(["git", "ls-files", "-co", "--exclude-standard"], capture_output=True, text=True).stdout.split()
fix = "--fix" in sys.argv
for name in files:
    p = Path(name)
    if p.suffix.lower() not in {".py", ".ts", ".tsx", ".js", ".md", ".html", ".yaml", ".yml", ".json", ".css", ".sql"}:
        continue
    text = p.read_text(encoding="utf-8", errors="replace")
    hits = [(i + 1, f"U+{ord(c):04X}") for i, line in enumerate(text.splitlines()) for c in line if ord(c) in BAD]
    if not hits:
        continue
    print(f"{name}: {len(hits)} char(s) on lines {sorted({h[0] for h in hits})} -> {sorted({h[1] for h in hits})}")
    if fix:
        p.write_text("".join(BAD.get(ord(c), c) for c in text), encoding="utf-8", newline="")
        print("   fixed")
