<img src="brand/beagle-mascot.png" alt="Scout" width="150" align="right">

# Beagle Brigade

**Scout sniffs every new npm and PyPI release for malware, in real time.**

At US airports the USDA's Beagle Brigade sniffs luggage for what should not
cross the border. Scout does the same job for package registries. Attackers
have put malware into npm and PyPI thousands of times in the last year, and
they did not break in: they published. A stolen token, a new version of a
package you already trust, and it runs on every laptop and CI runner that
installs it.

Built for a cyberdefense hackathon. Everything here is defensive: it watches
public registries for malicious uploads. It is not pointed at anyone, and it
never executes what it downloads.

---

## How it works

```
npm + PyPI feeds ──► sandboxed fetch ──► Semgrep + heuristics ──► score
      (seconds)      (never executed)      (dataflow rules)         │
                                                                    ▼
                                         ClickHouse (GCP Tokyo): logs,
                                         releases, findings, detections
                                                    │
                                   ┌────────────────┴─────────────────┐
                                   ▼                                  ▼
                        Guild agent triage                   live dashboard
                     (verdict, actions, confidence)        (Scout barks here)
```

1. **Tail the registries.** npm's replication `_changes` feed by sequence
   number, PyPI's updates RSS. New releases arrive within seconds.
2. **Fetch into a sandbox.** Download the tarball or wheel, extract under a
   strict budget, never run a line of it.
3. **Analyse.** Semgrep dataflow rules plus cheap text heuristics.
4. **Score.** Combinations convict, single rules do not.
5. **Store.** Every release, finding and detection lands in ClickHouse.
6. **Triage.** Each detection wakes an agent hosted on Guild, which writes the
   judgement an on-call engineer can act on.
7. **Show.** A live dashboard. Scout switches to his alert pose on a bark.

## What makes the detection work

### Install-time execution is the hinge

Code in a `preinstall`/`install`/`postinstall` hook, or in a `setup.py`
command class, runs on every machine that installs the package without anyone
opening a file. The same code in a library function someone must deliberately
call is far less serious.

Rules that only matter at install time carry `install_context: true`, and the
scanner **discards them entirely** unless they land in a file that genuinely
runs during installation, resolved from `package.json` scripts or `setup.py`.
Before that gate existed, scanning `express` produced dozens of hits.

### Combinations convict

`child_process.exec` is in thousands of honest build scripts. Credential reads
are in honest CLI tools. What is almost never innocent is install-time
execution *combined with* credential access, or obfuscation *combined with* a
loader. So install-time rules carry low weights and the score comes from
combination bonuses in [`score.py`](scanner/beagle/score.py).

The negative control proves it:
`fixtures/npm-benign-native-build` runs `node-gyp rebuild` from a postinstall
hook, exactly like thousands of real packages, and scores **13**. The four
malware fixtures score **100**.

### Not crying wolf was the hard part

Run naive rules against the real registry and they flag almost everything.
Three false-positive classes we found and fixed, each with a negative control
in [`rules/tests/`](rules/tests):

| What fired | Why it was wrong | Fix |
|---|---|---|
| Every well-behaved API client | Reading a token from the environment and sending it in an `Authorization` header is the *correct* way to use an API key | Split credential **files** (never legitimate) from **environment** variables (only suspicious at install time), and exclude the auth-header shape |
| A package that strips a BOM | The invisible-Unicode heuristic matched `text.replace(/^﻿/, "")` | Narrowed to bidi override and isolate characters, which have no honest use in source |
| A Bearer-token parser | `$CP.exec(...)` also matches `RegExp.prototype.exec`, so `/^Bearer\s+(.+)$/i.exec(header)` looked like a second-stage loader | Constrained the receiver by name |

Measured on real packages, before and after:

| Package | Before | After |
|---|---|---|
| `swarph-cli` | 100 | **0** |
| `breakaway` | 100 | **16** |
| `@paperclipai/plugin-cloudflare-sandbox` | 45 | **8** |
| malware fixtures | 100 | **100** |

### What Semgrep does here that grep cannot

The rules are taint-mode: they fire when data actually *flows* from a source
to a sink, through assignments and sanitizers, not when two strings happen to
appear in the same file.

One honest limitation, recorded as a `todoruleid` in the test suite so it
shows up on every run: the **OSS Semgrep engine is intraprocedural**. Taint
that crosses a function boundary needs Pro Engine. We do not claim coverage we
do not have.

## The numbers

- **9.5M** real npm registry change events replicated into ClickHouse,
  loaded at ~49,000 rows/sec
- Full-table aggregate over that history in **well under a second**
- Dashboard counter queries in **single-digit milliseconds**

## Running it

Prerequisites: Python 3.11+ with [uv](https://docs.astral.sh/uv/), Node 20+
with pnpm, and Semgrep (`uv tool install semgrep`).

```bash
cp .env.example .env     # fill in ClickHouse + Guild credentials

# scanner
cd scanner
uv sync
uv run beagle init-db                 # apply schema.sql
uv run beagle replay                  # scan the local fixtures (deterministic)
uv run beagle live --duration 600     # tail npm + PyPI for real
uv run beagle backfill --target 5000000   # bulk-load registry history
uv run beagle triage                  # hand detections to the Guild agent
uv run beagle stats

# dashboard
cd ../web
pnpm install
pnpm dev                              # http://localhost:3100
```

Rule tests:

```bash
semgrep --test --config rules/ rules/tests/
```

## Demo video

`demo/` builds a narrated walkthrough. Narration is ElevenLabs (not a
hackathon sponsor, used only for the voiceover); the screen capture is driven
by Playwright and timed to the audio, so picture and voice stay in sync
without hand-editing a timeline.

```bash
cd demo
pnpm install
node narrate.js      # ElevenLabs -> audio/*.mp3 + manifest.json
node record.js       # drives the dashboard, records video/dashboard.webm
node build-video.js  # -> build/beagle-brigade-demo.mp4
```

## Ground rules

These are in the code, not just the README.

- **Nothing downloaded is ever executed.** Archives are read as bytes,
  extracted under a size/count/path budget, analysed statically and deleted.
  Extraction rejects path traversal, absolute paths, symlinks and device
  entries, and bounds total uncompressed size against decompression bombs.
- **A human confirms before anything is called malicious in public.** The
  scanner produces evidence; the Guild agent produces a judgement; neither
  publishes an accusation.
- **No maintainer is ever named or blamed.** A compromised publishing token is
  far more common than a malicious maintainer, and the account owner is
  usually the first victim. The triage prompt forbids it and routes everything
  through the registry's security team.
- **Fixtures are inert.** Test inputs live in
  [`scanner/fixtures/`](scanner/fixtures), target `.invalid` hosts that cannot
  resolve, carry no payload, and are never published anywhere.

## Layout

| Path | What |
|---|---|
| `rules/` | Semgrep rules and their test fixtures |
| `scanner/` | Python pipeline: feeds, fetch, scan, score, store |
| `scanner/fixtures/` | Inert detection fixtures, including the negative control |
| `web/` | Next.js dashboard |
| `agent/` | The Guild triage agent's prompt |
| `demo/` | Narration, recording and video build |
| `brand/` | Scout |

## Sponsor fit

- **ClickHouse** is the whole data layer: millions of real registry events,
  sub-second aggregates, and detections that drive action. Table names and the
  signals/alerts split follow RunReveal's model, so the layout is familiar.
  That is a compatible schema, not an integration.
- **Semgrep** is the detection engine, with custom taint rules, a passing test
  suite and three documented false-positive classes hunted down against live
  registry traffic.
- **Guild** hosts the triage agent that turns a score into a decision.
