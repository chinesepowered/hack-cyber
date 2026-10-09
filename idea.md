# Beagle Brigade

<img src="brand/beagle-mascot.png" alt="Scout the beagle" width="180" align="right">

**Scout sniffs every new npm and PyPI package for malware in real time, and acts before the package reaches your code.**

At US airports, the USDA's "Beagle Brigade" sniffs luggage for prohibited food and plants. Scout sniffs packages. The npm worms of 2025–26 spread by publishing malicious versions of real packages, so we inspect every new release within seconds of it going live.

## Why this wins

| Prize | What judges see |
|---|---|
| Overall (Pi, $2,000) | Real malware published today, caught live on stage |
| ClickHouse (~$1,750 + credits) | A live feed plus a backfill of tens of millions of rows. Queries finish in milliseconds and alerts trigger actions. The schema follows RunReveal's table names. |
| Guild ($2,000) | The triage and response agent runs on Guild: it starts from an alert and acts through GitHub and Slack |
| Semgrep ($1,500) | Semgrep is the scanning engine. The prize entry is a separate side quest (see below). |

Confirm at the event that one project can win several sponsor prizes.

## How it works

```
npm / PyPI feeds ──► fetcher (sandbox, never installs) ──► Semgrep + metadata scoring
                                                                │
                                                                ▼
                                       ClickHouse: logs → detections → signals / alerts
                                                                │ alert webhook
                                                                ▼
                    Guild agent ──► verdict · lockfile check · pin PR · Slack (Scout barks)
                                                                │
                                                                ▼
                                                 Live dashboard + query panel
```

1. **Feeds.** Poll PyPI's RSS feeds (`https://pypi.org/rss/updates.xml`, `https://pypi.org/rss/packages.xml`) and npm's changes feed about every 30 seconds. npm moved its replication endpoints in 2025, so check GitHub's migration notes before relying on old examples.
2. **Fetch.** Download each tarball, wheel or sdist into a throwaway container that holds no credentials. Never install or run anything; extract and read only.
3. **Scan.** Run Semgrep with our own rules for malicious behavior (table below). Datadog's GuardDog rule list is a good checklist to port.
4. **Package vs. tag diff.** Compare the published package with the source repo's tagged release. Code that exists only in the package is a strong signal, and Semgrep findings in that extra code get extra weight.
5. **Metadata signals.** Look for a new publisher, a long-dormant package suddenly releasing, a major version jump on a popular package, a name close to a top package (`editDistance`), or a brand-new package with install scripts.
6. **Store.** Write one row per release, per finding, and per signal into ClickHouse. Materialized views handle real-time detection, and scheduled SQL handles correlation.
7. **Backfill.** Load past releases (e.g. from deps.dev's public BigQuery dataset) for scale and for baselines such as a publisher's usual release rhythm.
8. **Alert.** A detection sends a webhook to a Guild API trigger. Put a tiny relay in between if the auth header can't be set directly.
9. **Respond.** The Guild agent reads the flagged files and writes a plain-English verdict with evidence. It searches our repos' lockfiles for the package (GitHub integration), opens a PR pinning the last good version, and posts to Slack with Scout's alert picture. It also drafts a registry abuse report for a human to review.
10. **Show.** The dashboard has a live wall of sniffed packages and Scout, who switches to the alert pose on a hit. It also shows counters and a query panel with timings.

### Detection signals

| Signal | Source | Weight |
|---|---|---|
| Install-time script that spawns a process or makes a network call | Semgrep | High |
| Reads credential files, env vars, or tokens and sends them out | Semgrep | High |
| Obfuscated code, large encoded blobs, invisible Unicode | Semgrep | Medium |
| Downloads and runs a remote payload | Semgrep | High |
| Code present in the package but not in the tagged source | Diff + Semgrep | High |
| New publisher on an established package | Metadata | Medium |
| Lookalike name of a popular package | Metadata | Medium |
| Brand-new package that ships install scripts | Metadata | Low |

Score each release by combining signals. Rules are cheap and combinations are what matter.

### ClickHouse starting point

The table names (`logs`, `detections`, `signals`, `alerts`) and the `{from:DateTime}` / `{to:DateTime}` window style follow RunReveal's docs. The column names are our own. Describe this as "RunReveal-compatible", not as an integration.

```sql
CREATE TABLE logs (
    receivedAt  DateTime64(3) DEFAULT now64(3),
    eventTime   DateTime64(3),
    sourceType  LowCardinality(String),  -- 'npm' | 'pypi'
    eventName   LowCardinality(String),  -- 'release' | 'finding' | 'signal'
    package     String,
    version     String,
    publisher   String,
    ruleId      LowCardinality(String),
    severity    LowCardinality(String),
    file        String,
    line        UInt32,
    rawLog      String
) ENGINE = MergeTree
ORDER BY (sourceType, eventName, eventTime);

-- Scheduled detection: install-time execution plus network or credential access in one release
SELECT package, version, groupUniqArray(ruleId) AS rules
FROM logs
WHERE eventName = 'finding'
  AND eventTime BETWEEN {from:DateTime} AND {to:DateTime}
GROUP BY package, version
HAVING has(rules, 'install-script-exec')
   AND hasAny(rules, ['network-call', 'credential-read']);
```

### Guild notes

- TypeScript agents can't call outside hosts directly. Go through integrations: GitHub and Slack are built in. A custom integration (OpenAPI import) can reach ClickHouse, but only on a public endpoint, and its base URL is locked at first publish.
- Start sessions from alerts with an API trigger.
- If the free tier's token allowance is small, bring your own Anthropic key.
- Talk to the Guild team early about the free tier.

## Demo script (about 2½ minutes)

1. **Hook:** the Beagle Brigade story and this year's npm worms.
2. **Live wall:** "N packages sniffed today, M flagged, median X seconds from publish to verdict."
3. **A real catch from today:** the Semgrep finding with the code highlighted, plus the code that exists only in the package.
4. **Guild in action:** the agent's verdict, the pin PR it opened in our demo org, and the Slack alert with Scout.
5. **ClickHouse moment:** live queries across tens of millions of releases, with timings on screen. For example: every release by this publisher in 30 days, or every package that added install scripts in the last hour.
6. **Close:** static analysis, real-time analytics, and an agent that acts.

**Fallback:** if nothing real is caught, replay known-bad samples in replay mode. Record a backup video either way.

## Team split (4 people)

1. Feeds, sandboxed fetcher, Semgrep workers
2. ClickHouse schema, backfill, detections, dashboard
3. Guild agent, GitHub and Slack actions
4. Semgrep side quest, then slides and the backup video

## Plan for the day

- **First hour:** create accounts (ClickHouse Cloud, Guild, Semgrep), confirm prize stacking, start the backfill, stub the schema.
- **Morning:** feed, fetch, scan and ClickHouse working end to end, with about 5 detection rules.
- **Early afternoon:** Guild agent wired to alerts, PR and Slack actions, dashboard.
- **Late afternoon:** tune false positives, build replay mode, record the backup video, make slides.
- **Last hour:** freeze code and rehearse.

## Ground rules

- Never install or run downloaded packages. Static analysis only, in a throwaway container with no credentials.
- A human confirms a package before we call it malicious on stage.
- Report confirmed malware to the registry's security team.
- No public accusations against maintainers; a compromised account isn't a malicious person.

## Semgrep side quest (separate prize, one person, about 4 hours)

The Semgrep prize is for "a vulnerability or issue found in AI-generated code" and is judged on how unique or interesting the finding is.

1. Take the curated subset of the [AIDev dataset](https://huggingface.co/datasets/hao-li/AIDev): 33.6k pull requests written by Codex, Devin, Copilot, Cursor and Claude Code, with diffs.
2. Sample about 1,000 Python and JavaScript PRs and fetch the changed files as of the PR's final commit.
3. Run Semgrep and keep only findings on lines the agent added.
4. Slice the results by agent and bug type.
5. Lead with the single most surprising finding, ideally one where untrusted data flows across functions or files into something dangerous, which grep or a quick read would miss.
6. If a finding affects a live project, disclose it privately to the maintainers before showing it, and anonymize it.

## Fallback project

**Log line → code line.** ClickHouse spots attacks against our own AI-written demo app. Semgrep traces the attacked route to the exact vulnerable line. A Guild agent opens the fix PR, and a re-scan plus a replay prove it's closed. Use it if the package feeds misbehave. It runs the same way every time and gives us a second Semgrep entry.

## Open questions for the event

- Can one project win several sponsor prizes?
- What does Guild's free tier include, and can we bring our own model key?
- Would the ClickHouse judges like the RunReveal-compatible layer presented a particular way?

## Assets

Scout lives in [`brand/`](brand/) in three versions: the default pose, an alert pose for when a detection fires, and a round avatar for the favicon or bot.
