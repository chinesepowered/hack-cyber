# Cyberdefense Hackathon: v2 plan, after talking to sponsors

The first list is in [`IDEAS-v1.md`](IDEAS-v1.md). Its verified facts and SQL snippets still apply.

## What changed

| Sponsor | What they said | What we do now |
|---|---|---|
| ClickHouse ($1k / $500 / $250) | Any solid ClickHouse use counts; RunReveal would be cool, but we can't get access | Plain ClickHouse plus a **mocked, RunReveal-compatible layer** (below) |
| Pi ($1k / $600 / $400) | No product to integrate; "show us cool security" | Live moments on stage, real attacks and real data |
| Semgrep ($1k / $500, a separate *finding* prize) | "We're good at static analysis" | Real Semgrep static analysis in the loop (custom rules, taint mode), plus the finding track |
| Guild ($1k / $500 / $500) | Not contacted yet, so free tier | Free tier is plenty: 50M tokens at signup, plus 50M more if you set up a Software Factory |
| Akash | Credits aren't worth it | Dropped |

## The mocked RunReveal layer (reusable in any idea below)

RunReveal joined ClickHouse in September 2026 and its docs are public, so we can copy its shapes exactly:

- **Ingest.** Expose `POST /sources/hook/{id}` and accept RunReveal's structured-webhook JSON: `eventName`, `eventTime`, `readOnly`, `actor{id,email,username}`, `src{ip,port}`, `dst`, `service{name}`, `resources[]`, `tags{}`. Write it to a ClickHouse `logs` table with the same field names plus `rawLog`.
- **Detections.** Store them in RunReveal's format: a slug name, SQL that filters on `{from:DateTime}` / `{to:DateTime}` (which is ClickHouse's native query-parameter syntax), a cron schedule, a severity, and `mitreAttacks` / `mitreTechniques`. A ~50-line runner executes them and writes to a `signals` table. Detections with a notification target become alerts, which POST to a Guild API trigger.
- **Tools for agents.** Serve RunReveal's MCP tool names (`run_query`, `list_tables`, `get_table_schema`, `source_list`, `detections_create`, `notification_send`), backed by ClickHouse, on a public URL. A tunnel works; Guild integrations can't reach private addresses.
- **Pitch line:** "RunReveal-compatible. Point it at a real workspace and it works."

## 20 new ideas

Legend: **P** Pi · **G** Guild · **C** ClickHouse · **S** Semgrep. Effort assumes 3–4 people in about 4 hours.

### Tier S: build one of these

1. **Packet: EDR for AI coding agents.**
   - Claude Code / Cursor hooks stream every agent action into ClickHouse as RunReveal-format events.
   - Detections cover what malware wants an agent to do: read credential files, change its own safety settings, run with permission-bypass flags from a non-interactive parent, reach unknown hosts, create public repos.
   - A pre-install hook runs Semgrep on any package the agent tries to install, and blocks it if the install scripts look risky.
   - A Guild responder triages each alert and opens an incident.
   - *Why now:* the Aug 2025 Nx "s1ngularity" attack launched developers' own AI CLIs to hunt for secrets.
   - *Wow:* a planted instruction in a test repo nudges the agent toward a decoy credentials file, and it's caught and contained in seconds.

   P★★★ G★★★ C★★ S★★ · Effort: medium.
2. **npm Sniffer: live malicious-package radar.**
   - Follow npm's public changes feed. I tested `replicate.npmjs.com/registry/_changes`: it's live, about 4.5M packages, no auth.
   - Cheap metadata red flags first: a newly added install script, provenance that suddenly disappears, one account publishing across many packages at once.
   - Then fetch the tarball (never execute it) and run Semgrep rules for install-time credential access, obfuscation, invisible Unicode and network calls.
   - Store hits in ClickHouse. A Guild agent drafts a report for a person to approve and submit.
   - *Wow:* real suspicious packages flagged live during the event.

   P★★★ S★★★ C★★ G★★ · Effort: medium.
3. **Worm Watch.** Replay the real Sha1-Hulud 2.0 outbreak (3.2B public GitHub events) through the RunReveal-format pipeline. A RunReveal-style detection fires about 10 minutes after onset, and a Guild agent sizes the blast radius and checks your org. The data and query are already verified (see v1).

   C★★★ P★★★ G★★ S★ · Effort: medium · Risk: low.
4. **Two-Sided Coverage.** Paste in a threat write-up. A Guild agent writes two things:
   - a Semgrep rule that stops the pattern in code, checked against test fixtures;
   - a RunReveal-style detection that catches it at runtime, checked for true and false positives against replayed data in ClickHouse.

   It then opens PRs for both. *Wow:* from advisory to two tested guardrails in about 2 minutes.

   S★★★ C★★★ G★★★ P★★ · Effort: medium.

### Tier A: strong, but narrower fit or more risk

5. **Ghost Text.** Semgrep rules that find invisible Unicode and hidden instructions in code, configs and AI rules files. These are the GlassWorm (Oct 2025) and "Rules File Backdoor" (2025) techniques.
   - Scan your org and measure how common this is in public repos.
   - Open clean-up PRs automatically.
   - Reveal the hidden text live on stage.

   S★★★ P★★★ G★★ C★★ · Effort: low-medium.
6. **AI-PR Census.** Find code written by AI agents in public repos. The Claude Code footer shows up in about 250 comments across about 160 repos in 4.5 days of the GitHub data, and GitHub search finds many more.
   - Scan those diffs with Semgrep, including a custom taint rule.
   - Chart the results per agent in ClickHouse.
   - A Guild agent drafts private disclosures.

   This also produces your Semgrep submission. S★★★ P★★★ C★★ G★★ · Effort: medium.
7. **Upgrade X-Ray.** On every dependency-bump PR, diff the package's actual code between the two versions and run Semgrep on the diff. Look for new install hooks, new network calls, new eval or obfuscation, and new invisible characters, then comment a verdict. Compromised-maintainer releases get in this way.

   S★★★ P★★★ G★★ C★ · Effort: medium.
8. **MCP Flight Recorder.** A transparent proxy in front of MCP servers logs every tool call and tool definition to ClickHouse. It flags a server that silently rewrites its tool descriptions or adds tools (a "rug pull"), unusual data volumes, and new outbound hosts. Semgrep scans the server code.

   P★★★ C★★ G★★ S★★ · Effort: medium.
9. **Exposure Time Machine.** Load every lockfile from your repos' git history (package@version × repo × date), plus runtime logs, into ClickHouse. When an advisory lands, answer in milliseconds: were we ever exposed, where, for how long, and was the affected code actually exercised? A Guild agent writes the timeline and the fix PRs.

   C★★★ P★★ G★★ S★★ · Effort: medium.
10. **Live Attack Theater.** A low-interaction sensor on a cheap cloud VM records real internet scanning all day into ClickHouse in RunReveal format. Show a live map and campaign clustering on stage; a Guild agent writes hourly briefs and blocklists. *Wow:* "these are real scans hitting us during this talk." Start it at 11:00 so data builds up.

    P★★★ C★★★ G★★ · Effort: medium.
11. **Extension Sniffer.** Watch VS Code / Open VSX and Chrome extension updates and diff each new version with Semgrep: invisible Unicode, new permissions, new remote endpoints, credential access. These are the GlassWorm and hijacked-extension patterns. A Guild agent alerts the orgs that have the extension installed.

    S★★★ P★★★ C★ G★★ · Effort: medium.

### Tier B: solid but narrower

12. **Secret Blast Radius.** Given a leaked key, show everything it touched in milliseconds. Demo it on the public flaws.cloud CloudTrail dataset (real attacker activity against a training site). A Guild agent drafts the rotation plan.

    C★★★ P★★ G★★ · Effort: medium.
13. **Red Button.** One click runs harmless, scripted simulations of worm and agent-abuse behaviors in a sandbox. A ClickHouse scorecard shows which detections fired and how fast, and a Guild agent drafts detections for the gaps.

    P★★ G★★★ C★★ S★ · Effort: medium.
14. **Prompt DLP.** Catch secrets and PII leaving through LLM prompts, using Semgrep-Secrets-style patterns plus entropy checks in ClickHouse. Redact, alert, and track which tools leak the most.

    P★★ C★★ S★★ G★★ · Effort: low-medium.
15. **Rotation War Room.** After a leak, Guild agents rotate credentials across GitHub, npm and cloud accounts. Each agent has scoped credential policies and a human approval step. ClickHouse tracks how long each secret was exposed.

    G★★★ P★★ C★★ · Effort: medium.
16. **Session Hijack Hunter.** Detect stolen session cookies being reused (new device or network, impossible travel) in identity-provider logs at scale, and have a Guild agent revoke the sessions. Use synthetic Okta-format data.

    C★★★ G★★ P★★ · Effort: low-medium.
17. **CI Runner Watch.** Statically, use Semgrep's GitHub Actions rules (injection, unpinned actions, broad permissions). At runtime, watch job network traffic and new self-hosted runner registrations. A Guild agent opens hardening PRs.

    S★★ C★★ G★★ P★★ · Effort: medium.
18. **Reviewer Showdown.** Benchmark LLM-only reviewers, Semgrep, and a hybrid on a labeled set of AI-written vulnerabilities. Chart precision, recall and cost, and host the reviewers on Guild with Guild evals.

    S★★★ G★★ C★ P★ · Effort: low-medium.
19. **Agent Least-Privilege.** Compare what each coding agent is allowed to do (permission allowlists, MCP servers, tokens) with what it actually used. Generate a tighter config, plus Semgrep rules that block risky agent configs in PRs.

    G★★ P★★ S★★ C★ · Effort: low-medium.
20. **Exposure Diff.** Semgrep pulls the routes, auth decorators and permissions out of each PR and comments exactly what new attack surface the PR adds. History lives in ClickHouse.

    S★★★ P★★ G★★ C★ · Effort: low-medium.

## Recommendation: Packet (#1), plus the Semgrep install gate from #2 and the Worm Watch replay from #3 as proof of scale

It's the one idea that is at once:
- cool and timely for Pi: AI agents are the new attack surface, with live containment on stage;
- a real ClickHouse workload with a RunReveal-compatible layer;
- real Semgrep static analysis in the loop;
- a Guild-hosted responder using triggers, integrations and credential policies.

**Team split (4 people):**

| Role | Builds |
|---|---|
| Data | ClickHouse service, `logs` / `signals` tables, webhook and detection runner, a 100M-event synthetic fleet, the worm replay slice |
| Sensor | Claude Code hooks → webhook; the pre-install Semgrep gate; 5–6 agent-behavior detections |
| Responder | Guild API trigger, native responder agent, a custom integration to the mock (REST or MCP through a tunnel), GitHub integration, credential policies |
| Story + Semgrep | Semgrep finding (see below), demo script, slides with Packet, a README with a per-sponsor checklist, a backup video |

**Timeline:**

| Time | Work |
|---|---|
| 11:00–11:45 | Setup and smoke tests. Do the tunnel and the Guild integration first, since they're the riskiest. |
| 11:45–14:00 | Build in parallel. |
| 14:00–15:00 | Wire everything end to end. |
| 15:00–16:00 | Freeze, rehearse, record the backup video. |
| 16:00–16:30 | README and submit. |

If you're behind at 14:00, drop the MCP mock (keep REST) and the synthetic fleet. Keep the live chain: hook → detection → Guild → incident.

**Demo (3 minutes):**
1. Packet, and why now: s1ngularity.
2. One query over 3.2B events catches the outbreak at 03:10 UTC.
3. The agent tries to install a local test package whose install script matches a rule (never executed). The Semgrep gate blocks it and shows the evidence.
4. A planted instruction steers the agent toward a decoy credentials file. The detection fires and Guild opens the incident in seconds.
5. Fleet-scale numbers, and the "RunReveal-compatible" closer.

## Semgrep finding track (one person)

- **Main route:** the AI-PR Census (#6). Pick one narrow, high-signal pattern. Scan AI-authored diffs with registry rules plus one custom taint rule, confirm the hits by hand, and report them privately. Submit the best one, redacted until it's fixed.
- **Show the craft:** the custom rule, its test fixtures, and the variants it finds.
- **Backup:** Semgrep Guardian findings in the code your own agents write today.

## Mascot

**Packet, the sniffer beagle**, in `assets/mascot/`:
- `beagle.svg` / `beagle.png` (1024 px, transparent background)
- `beagle-icon.svg` / `beagle-icon-512.png`, plus `favicon-32.png`
- `beagle-plate.png`, a presentation sheet with palette and sizes
- `PHILOSOPHY.md`, the design notes

The mascot files have no text, so you can rename it freely.

## Sources

- RunReveal joining ClickHouse: https://blog.runreveal.com/runreveal-is-joining-clickhouse/
- RunReveal docs index: https://docs.runreveal.com/llms.txt
- RunReveal PQL: https://github.com/runreveal/pql
- Guild free tokens: https://www.guild.ai/pricing
- s1ngularity: https://wiz.io/blog/s1ngularity-supply-chain-attack · https://orca.security/resources/blog/s1ngularity-supply-chain-attack/
- GlassWorm: https://koi.ai/blog/glassworm-first-self-propagating-worm-using-invisible-code-hits-openvsx-marketplace
- Rules File Backdoor: https://thehackernews.com/2025/03/new-rules-file-backdoor-attack-lets.html
- npm replication API changes: https://github.blog/changelog/2025-02-27-changes-and-deprecation-notice-for-npm-replication-apis/
