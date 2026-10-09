# Cyberdefense Hackathon: 20 ideas ranked by expected prize money

> Superseded by [`IDEAS.md`](IDEAS.md) (v2, after talking to sponsors). The verified data facts and snippets below still apply.

## What changes the strategy

- **Time is short.** Hacking starts at 11:00 and submissions close at 16:30; finalists demo at 17:00. That's about 4 hours of building after setup and lunch.
- **Cash on the table:**
  - Pi overall: $2,000 (1,000 / 600 / 400)
  - Guild: $2,000 (1,000 / 500 / 500), with three winners
  - ClickHouse: $1,750 cash, plus credits
  - Semgrep: $1,500 (1,000 / 500), judged on a *finding*, not a project
  - Akash: credits only
- **Play:** build ONE project that stacks Guild + ClickHouse (with AkashML for inference), and pitch it in Pi's language: find → understand → fix → prevent. Pi's own pitch is "fix once, stays fixed everywhere." Put one person on the Semgrep finding track in parallel.
- **Ask at kickoff:** can one team win several sponsor prizes? If not, Guild's three slots are the best odds.
- **Judges** include Guild (Corbett Waddingham), ClickHouse (Dustin Healy), Semgrep (Daghan Altas), Akash (Greg Osuri) and two from Pi. Sponsor judges may only read your submission, so the README must state rows, latency in ms, and which sponsor features you used.

## Shortcuts I verified

1. **Billion-row security data, already loaded, free.** ClickHouse's public playground (`https://play.clickhouse.com`, user `play`, read-only) holds these tables:

   | Table | Rows | Coverage |
   |---|---|---|
   | `github_events` | 3.17B | Jan 2023–Jul 2026 (gap: Jun 2024–Sep 2025) |
   | `dns` / `dns2` (passive DNS: domain, A, AAAA, CNAME) | 2.19B / 2.45B | 2021–22 |
   | `rdns` | 1.24B | 2021 |
   | `tranco` / `cisco_umbrella` (daily top-1M ranks) | 1.8B / 2.57B | to Jan 2024 |
   | `pypi` (per-file index of 466K projects) | 1.03B | to Sep 2023 |
   | `mgbench.logs2` (real web-server access log) | 75M | 2012 |
   | `workflow_jobs` (CI jobs) | 73M | |

   Aggregations returned in 0.3–1.3 s, and a full `LIKE` scan of 2.45B rows took about 4 s. It is a shared box with a memory cap, though: wide text scans of `body` fail. Copy the slice you need into your own ClickHouse Cloud service for stable numbers.
2. **A real attack is in that data.** Starting 2025-11-24, branch-creation events in repos with random 18-character lowercase names climb fast:
   - Baseline: 2–3 per 10 min.
   - 03:10 UTC: 21.
   - About 08:00 UTC: roughly 2,000 per hour.
   - Over two days: about 14.8K repos across about 778 accounts.

   This matches public reporting on the Sha1-Hulud 2.0 npm worm, which created randomly named repos to hold stolen secrets. One aggregate query surfaces it in about 1 s (appendix).
3. **Detection can call an agent without glue code.** A ClickStack SQL alert can POST a generic webhook with custom headers and body, so it can call Guild's API trigger directly. The trigger takes `POST https://api.guild.ai/v1/workspaces/{owner}/{workspace}/sessions` with Basic auth and `{"session_type":"api_trigger","agent_input":{...}}`. Alert intervals start at 1 minute. Fallback: a 20-line poller.
4. **ClickHouse can run an LLM inside SQL, on Akash.** The AI functions are `aiClassify`, `aiFilter`, `aiExtract`, `aiRedact`, `aiGenerate`, `aiEmbed` and `aiSimilarity`. They are beta, added between 26.4 and 26.8.
   - They accept any OpenAI-compatible endpoint, including AkashML at `https://api.akashml.com/v1`. AkashML lists `openai/gpt-oss-20b` at about $0.03 per 1M input tokens.
   - They are **not on ClickHouse Cloud yet**, so self-host 26.8+ (Docker, or deploy it on Akash).
5. **Guild's limits shape the design:**
   - Agents have no direct internet. They reach services only through integrations: REST or MCP, with credentials injected server-side.
   - A ClickHouse integration can use either:
     - Query API Endpoints (saved, parameterized queries run with a read-only DB role).
     - ClickHouse Cloud remote MCP (`https://mcp.clickhouse.cloud/mcp`).
   - The URL must be public, because private and loopback addresses are blocked.
   - Credential policies (allow only GET, deny writes, scope per agent) give you a ready-made security story.
   - AkashML is **not** a Guild LLM provider. Supported providers are Anthropic, OpenAI, Gemini, Meta, Bedrock, Fireworks and OpenRouter. Call AkashML through a custom integration or from the data layer instead.
6. **Guardian works with open models.** Guardian's Claude Code plugin scans every file the agent writes, using the fixed `guardian-default` rules plus Supply Chain and Secrets checks. AkashML also serves an Anthropic-compatible endpoint (`https://api.akashml.com/anthropic`), so Claude Code, and Guardian with it, can run against open models (GLM-5.3, Kimi-K3, Qwen, gpt-oss).
7. **Guild's Software Factory** turns labeled GitHub issues into reviewed PRs, and Guild's Smith agent can set one up from chat.

## The 20 ideas

Legend: **P** Pi overall, **G** Guild, **C** ClickHouse, **A** Akash, **S** Semgrep. Effort assumes 3–4 people for about 4 hours.

### Tier S: build one of these

1. **Patient Zero: supply-chain worm early warning.** Replay the Nov 2025 outbreak from the GitHub event stream at 60×, through a materialized view.
   - An alert fires within about 10 minutes of onset.
   - A Guild "incident commander" agent pulls the blast radius through a ClickHouse integration and writes the advisory.
   - A second agent checks *your* repos and lockfiles for affected packages and opens pin and rotate PRs.
   - Optional: a live mode on the GitHub Events API.

   *Wow:* "this query would have caught it in its first 10 minutes." C★★★ G★★★ P★★★ A★ S★. Effort: medium. Risk: low, since the data is verified.
2. **Incident → Fix → Guardrail ("fix once, stays fixed").** Your demo app's logs flow into ClickHouse and a detection fires. Guild agents then:
   - map the route to the code;
   - open a fix PR;
   - write and test a new Semgrep rule and add it to CI, so neither people nor AI agents can bring the pattern back.

   Re-run the traffic and it's blocked. This is Pi's pitch, built. P★★★ G★★★ S★★ C★★ A★. Effort: high.
3. **LLM in the WHERE clause.** Run ClickHouse AI functions on AkashML.
   - A SQL pre-filter cuts 75M real web-log lines to about 2K suspicious ones in milliseconds.
   - `aiClassify` and `aiExtract` label them with a MITRE technique.
   - `aiRedact` strips PII before any agent sees the data.
   - Show the cost per 100K classifications.

   Design point: LLM verdicts are advisory, and deterministic rules keep a veto (ClickHouse's docs call AI-function output untrusted). C★★★ A★★★ G★★ P★★. Effort: medium. Risk: beta feature.
4. **Agent EDR: a SIEM for your AI agents.** Stream Guild session events into ClickHouse and flag misbehaving agents: credential-policy denials, odd tool sequences, token spikes, new outbound domains. Contain them automatically through Guild by stopping the session, pausing the trigger, or adding a DENY rule. Demo it with a deliberately misbehaving test agent. G★★★ P★★★ C★★ A★. Effort: medium-high.

### Tier A: strong, but narrower prize fit or more risk

5. **Issue Gatekeeper for the Software Factory.** The Factory turns issues into PRs, so issues are an input channel to a coding agent. A gatekeeper agent screens new issues for text aimed at AI agents and holds them for human review. A ClickHouse panel from the GitHub event stream shows this happens in the wild: about 15 literal "ignore previous instructions" issues and comments in a 12-day sample. G★★★ P★★★ C★★ A★★. Effort: medium.
6. **Vibe-Code Vuln Census.** Run the same 20 everyday build prompts through Claude and 4–5 open models (Claude Code on AkashML), with Guardian on. Store every finding in ClickHouse and build a leaderboard by model, CWE, and how often Guardian feedback led to a fix. It also feeds your Semgrep submission. S★★★ A★★★ P★★ C★. Effort: low-medium.
7. **Phish Radar / Brand Shield.** Type a brand and get its lookalike domains from 2.45B DNS rows and 4.3B rank-history rows, clustered by shared IP, with the newest risers first. An agent drafts takedown reports. In testing, "paypal" turned up about 50K lookalikes across about 8.4K IPs. C★★★ G★★ A★ P★. Effort: low. Weakness: the data is a 2021–22 snapshot.
8. **Semgrep → Guild Software Factory.** A CI scan files labeled issues; the Factory plans, fixes and reviews; a re-scan gates the merge. ClickHouse tracks time to fix. G★★★ S★★ P★★ C★. Effort: low-medium. Factory runs take minutes, so start one before you go on stage.
9. **Sensor grid on Akash.** Run low-interaction listeners on several Akash providers in different regions. They stream scan telemetry into ClickHouse in real time, and a Guild agent groups campaigns and publishes a blocklist. This is the strongest "why Akash" story: cheap, permissionless, global. A★★★ C★★★ G★★ P★. Effort: medium-high. Risk: traffic within a few hours is unpredictable, so pad with a replay of the web logs.
10. **Slopsquat Guard.** A Claude Code hook plus a Guild PR agent that flag dependencies an AI agent adds when they look hallucinated, are brand-new, or are one edit away from a popular package. It uses the PyPI index plus live registry metadata. P★★ S★★ C★★ G★★. Effort: low-medium.
11. **CloudTrail Kill-Chain Detective.** Load the public flaws.cloud CloudTrail dataset from Summit Route (real attacker activity against a deliberately vulnerable training site). `windowFunnel` and `sequenceMatch` find the steps, and an agent explains the chain and proposes a least-privilege IAM policy. AWS hosts the event and has a judge. C★★★ G★★ P★★. Effort: medium.

### Tier B: solid but narrower

12. **Patch-to-Rule Variant Hunter.** Starting from a CVE fix, an agent writes a Semgrep rule and tests it on the before and after code. It then finds the same pattern across your org's repos and files issues. S★★★ P★★★ G★★. Effort: medium.
13. **CI/CD Hardener.** Semgrep's GitHub Actions rules, plus an agent that pins third-party actions to commit SHAs and tightens `permissions:`. Add an anomaly panel over the 73M CI-job rows. S★★ G★★ P★★ C★. Effort: low-medium.
14. **MCP Server Auditor.** Write Semgrep rules for risky patterns in the MCP servers your team depends on, and have a Guild agent open issues with suggested fixes. S★★★ P★★ G★★. Effort: low-medium.
15. **Attacked × Reachable prioritizer.** Combine Semgrep Supply Chain reachability with live attack traffic on the same endpoints in ClickHouse to build a "patch now" queue that opens PRs automatically. P★★★ S★★ C★★ G★★. Effort: medium.
16. **Voice SOC.** On a critical alert, a Guild agent phones the on-call engineer with a briefing, using Guild's Twilio integration and an ElevenLabs voice. Spoken questions are answered from ClickHouse, and remediation is approved by voice. Works as a demo add-on to any idea. P★★ G★★ C★. Effort: medium.
17. **Canary credentials.** Plant decoy credentials in your own repos and configs. Any use triggers an alert and a ClickHouse timeline, and a Guild agent rotates the real secrets and traces where the decoy leaked from. P★★ G★★ C★. Effort: medium.
18. **Least-Privilege Copilot for agents.** Compare what each Guild agent actually called with its credential policies, then generate a tighter policy and apply it through the CLI. G★★★ P★★. Effort: medium. Data scale is small.
19. **DGA / C2 Beacon Hunter.** Compute entropy and n-gram features over 2.45B DNS rows, filter with rank history, and group by IP. Output the detections as Sigma rules. C★★★ G★★ A★. Effort: low. Fairly generic.
20. **Lateral-Movement Hunter on LANL auth data.** A public dataset of about 1.6B events with labeled red-team activity, so you can show precision and recall live. C★★★ G★. Effort: medium. The download is several GB, so check it first.

## Recommendation: #1 with a short #2 ending

| Time | Work |
|---|---|
| 11:00–11:45 | Start a ClickHouse Cloud trial and copy the Nov 20–26 2025 slice. Set up the Guild account and CLI. Test integration auth first and give it 30 minutes at most. |
| 11:45–13:30 | Build the detector (materialized view plus replay script). Create Query API endpoints: signal, blast radius, victim repos. Write a native "incident commander" agent with an API trigger. |
| 13:30–15:00 | Wire the alert to the trigger. Add a second agent: "are we affected?" (run Semgrep Supply Chain on your repo, then a pin PR). Add AkashML summaries through a custom integration. |
| 15:00–16:30 | Build a dashboard showing rows scanned and ms, and publish the agents to the Agent Hub. Record a 2-minute backup video, write the README, and submit. The Semgrep person submits separately. |

What to show each judge:
- **ClickHouse:** rows scanned, milliseconds, and the action the alert triggered.
- **Guild:** sessions, sub-agents, triggers, the custom integration, credential policies, published agents.
- **Akash:** why open, decentralized inference suits security data (data sovereignty, cost per 100K events).
- **Pi:** find → understand → fix → prevent.

## Semgrep side-quest (one person, about 1 hour)

- Install Guardian.
- Have agents build ordinary features (auth middleware, file upload, webhook receiver, CI workflow, ML model loading, an MCP tool), once on Claude and once on open models through AkashML.
- Log every finding with the prompt, model, diff, Guardian output and fix.
- Submit the most surprising one, especially if it's something AI agents do that people rarely do. Examples:
  - pinning old dependency versions with known CVEs;
  - turning off TLS verification to "fix" a certificate error;
  - CI steps that put untrusted event fields into shell commands;
  - loading untrusted model files with unsafe deserialization.
- Package it with a one-paragraph "why it matters", the fix, and the line "Guardian caught it before commit."

## Appendix: snippets

The detector, verified against the playground in about 1 s:

```sql
SELECT toStartOfTenMinutes(created_at) AS t,
       count() AS events,
       uniq(actor_login) AS accounts
FROM github_events
WHERE event_type = 'CreateEvent'
  AND created_at BETWEEN '2025-11-24 02:00:00' AND '2025-11-24 05:00:00'
  AND match(splitByChar('/', repo_name)[2], '^[a-z0-9]{18}$')
GROUP BY t ORDER BY t;
```

Copying the slice into your own service is untested. It should work; if it doesn't, use `url()` against the playground's HTTP endpoint.

```sql
INSERT INTO gh.github_events
SELECT * FROM remoteSecure('play.clickhouse.com:9440', 'default.github_events', 'play', '')
WHERE created_at BETWEEN '2025-11-20' AND '2025-11-27';
```

AkashML as the AI-function backend. This needs self-hosted ClickHouse 26.8+ and is untested; the format follows the ClickHouse docs.

```sql
CREATE NAMED COLLECTION akashml AS
  provider = 'openai',
  endpoint = 'https://api.akashml.com/v1/chat/completions',
  model = 'openai/gpt-oss-20b',
  api_key = '<AKASHML_KEY>';
SET ai_function_text_default_credentials = 'akashml';
```

## Sources

- Event page: https://luma.com/cyberhack
- About Pi: https://www.vcaonline.com/news/2026061008/pi-raises-35m-to-make-security-scale-as-fast-as-code/
- Sha1-Hulud 2.0 reporting:
  - https://www.elastic.co/blog/shai-hulud-worm-2-0-updated-response
  - https://redhuntlabs.com/blog/sha1-hulud-the-second-coming-github-patterns-exposes-a-deeper-npm-attack/
  - https://cloudflare.semgrep.dev/blog/2025/digging-for-secrets-sha1-hulud-the-second-coming-of-the-npm-worm
- Docs:
  - https://docs.guild.ai/llms.txt
  - https://clickhouse.com/docs/llms.txt
  - https://docs.semgrep.dev/llms.txt
  - https://akashml.com/docs/llms.txt
