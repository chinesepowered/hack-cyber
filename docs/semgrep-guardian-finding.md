# Semgrep finding: an AI agent wrote Trojan Source into a Trojan Source detector

**Project:** Beagle Brigade, a real-time malicious-package scanner for npm and
PyPI, built entirely by an AI coding agent (Claude Code) during the
hackathon.
**Tools:** Semgrep Guardian in the agent session, plus a full-repo sweep with
the Semgrep registry rulesets (`p/default`, `p/secrets`, `p/python`,
`p/typescript`, `p/react`).
**Rule that fired:** `contains-bidirectional-characters`.

## The vulnerability class

Trojan Source (CVE-2021-42574) hides Unicode bidirectional control
characters (U+202A to U+202E, U+2066 to U+2069) in source code. Editors and
code review show one thing while the compiler or interpreter runs another.
The characters are invisible, so a reviewer looking at a diff cannot see them.

## What the agent did

Beagle Brigade scans packages for Trojan Source, so it needs a regex that
matches those characters. The agent wrote it in
`scanner/beagle/scan.py` by **pasting the raw, invisible characters straight
into the source**:

```
INVISIBLE = re.compile(r"[<U+202A>-<U+202E><U+2066>-<U+2069>]")
```

(Shown here with the invisible characters spelled out. In the real file they
were literal, and every editor, terminal and GitHub diff rendered the line as
an innocent-looking `r"[-]"`.)

So the detector for invisible-character attacks was itself an
invisible-character hazard. Nobody reviewing the diff could tell what that
regex matched, or that the file contained bidi controls at all. The same
session had also left stray U+FEFF (zero-width no-break space) characters in
`README.md` and `slides.html`.

## It happened three times, and the cause is systematic

After the first fix, the agent wrote the finding up in the README, and in the
sentence showing the corrected escape it put the same four raw bidi
characters back. Then it wrote this document, and the two lines meant to show
the safe escaped form came out containing the raw characters again. Our
checker caught all three.

The cause is in how coding agents write files. The agent edits files through
tool calls whose arguments are JSON strings, and in JSON a backslash-u
followed by four hex digits is an escape that decodes to the character
itself. So when the agent types the escape sequence, meaning the six literal
characters, the file writer receives the invisible character. Every attempt
to write the safe form produced the hazard. The same text written by a plain
Python script, which never goes through that decoding step, came out clean.

That makes this a reproducible mechanism, not one careless line: **an AI
agent that writes files through JSON tool calls cannot reliably type a
Unicode escape**, and the failure is invisible to the agent, the user and the
reviewer. The agent knew exactly what the bug was, had just fixed it, and
reproduced it twice more while describing the fix. Only a tool that reads
bytes rather than glyphs sees it, which is why scanning AI-generated code has
to be continuous and mechanical.

## Why it matters beyond this repo

AI coding agents generate a large and growing share of production code.
Invisible characters are an ideal blind spot: they survive copy and paste,
they do not change behaviour visibly, and they do not show up in review. The
same mechanism that let our agent produce a harmless-but-unreadable regex is
how a prompt-injected or compromised agent could slip a real Trojan Source
payload into a pull request.

## Fix

All literal invisible characters were rewritten as ASCII escapes:

```
INVISIBLE = re.compile(r"[\u202a-\u202e\u2066-\u2069]")
```

Python's `re` interprets `\uXXXX` in patterns, so behaviour is unchanged, and
we verified it after the fix:

- real Trojan Source input is still caught
- honest BOM handling (`text.replace(/^\ufeff/, "")`) is still ignored
- `scan.py` is now pure ASCII

`scripts/check_invisible.py` sweeps every tracked text file for these
codepoints and rewrites them with `--fix`. Run it before committing.

## Everything else the sweep found

All twelve findings were in AI-written code. Every one was fixed or
explicitly triaged:

| Finding | Verdict | Action |
|---|---|---|
| Bidi and BOM characters in `scan.py`, `README.md`, `slides.html` | Real | Rewritten as ASCII escapes |
| ClickHouse password sent in the URL query string (Python and web clients), found by review during the same pass | Real: query strings land in proxy and access logs | Moved to `X-ClickHouse-User` / `X-ClickHouse-Key` headers |
| f-string table names in `INSERT` / `TRUNCATE` | Real but internal | Identifiers checked against a strict pattern; `releases; DROP TABLE logs` is rejected |
| `sqlalchemy-execute-raw-query` | False positive: no SQLAlchemy; values are bound as ClickHouse parameters | `nosemgrep` with the reason inline |
| Playwright `goto` / `evaluate` injection in demo tooling | The env-driven URL was a real gap; the rest were constant inputs | URL locked to localhost; the rest annotated with reasons |

**12 findings → 0.** The project's own Semgrep rule suite still passes 13/13.
