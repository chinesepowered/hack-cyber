"use client";

import { Fragment } from "react";
import Scout from "./Scout";

export type Finding = {
  ruleId: string;
  engine: string;
  severity: string;
  weight: number;
  file: string;
  line: number;
  snippet: string;
  message: string;
};

export type Detection = {
  detectedAt: string;
  ecosystem: string;
  package: string;
  version: string;
  publisher: string;
  score: number;
  severity: string;
  verdict: string;
  ruleIds: string[];
  signalIds: string[];
  mitre: string[];
  summary: string;
  agentVerdict: string;
  agentActions: string[];
  notified: boolean;
};

type Agent = { label: string; sentence: string; confidence: string; confidenceWhy: string; why: string[] };

const LABEL = /(MALICIOUS|SUSPICIOUS|LIKELY BENIGN)/i;

/** The agent's reply is stored as JSON; older rows hold a plain string. */
function parseAgent(raw: string): Agent | null {
  if (!raw) return null;
  let verdict = raw;
  let confidence = "";
  let why: string[] = [];
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      verdict = String(parsed.verdict ?? "");
      confidence = String(parsed.confidence ?? "");
      why = Array.isArray(parsed.why) ? parsed.why.map(String) : [];
    }
  } catch {
    /* plain-text verdict from an older row */
  }
  const clean = verdict.replace(/\*\*/g, "");
  const label = (LABEL.exec(clean)?.[1] ?? "").toUpperCase();
  const sentence = clean
    .replace(/`/g, "")
    .replace(/^\W*(MALICIOUS|SUSPICIOUS|LIKELY BENIGN)\W*/i, "")
    .replace(/^[-–—:.\s]+/, "")
    .replace(/\(confidence:[^)]*\)\s*$/i, "")
    .trim();
  const conf = /(HIGH|MEDIUM|LOW)/i.exec(confidence.replace(/`/g, ""));
  return {
    label,
    sentence,
    confidence: conf ? conf[1].toUpperCase() : "",
    confidenceWhy: confidence.replace(/`/g, "").replace(/^\W*(HIGH|MEDIUM|LOW)\W*/i, "").trim(),
    why: why.map((w) => w.replace(/\*\*/g, "")),
  };
}

/** Render `backticked` spans from the agent's prose as inline code. */
function Inline({ text }: { text: string }) {
  const parts = text.split("`");
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <code key={i} className="rounded bg-sunken px-1 py-px font-mono text-[0.88em] text-ink ring-1 ring-line">
            {part}
          </code>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

const AGENT_TONE: Record<string, string> = {
  MALICIOUS: "bg-bad text-white",
  SUSPICIOUS: "bg-warn text-white",
  "LIKELY BENIGN": "bg-good text-white",
};

export default function DetectionPanel({
  detection,
  findings,
}: {
  detection: Detection | null;
  findings: Finding[];
}) {
  if (!detection) {
    return (
      <div className="card flex h-full flex-col items-center justify-center gap-4 p-10 text-center">
        <Scout alert={false} size={120} />
        <div>
          <div className="text-[17px] font-semibold text-ink">Nothing on the nose yet</div>
          <p className="mx-auto mt-1 max-w-[320px] text-[14px] leading-relaxed text-ink-2">
            Scout is working through the feed. The first flagged package opens here with the code
            that triggered it.
          </p>
        </div>
      </div>
    );
  }

  const malicious = detection.verdict === "malicious";
  const agent = parseAgent(detection.agentVerdict);

  return (
    <div className="card flex h-full min-h-0 flex-col overflow-hidden">
      {/* Verdict band */}
      <div
        className={[
          "flex items-center gap-5 border-b px-6 py-5",
          malicious ? "border-bad-line bg-bad-soft" : "border-warn-line bg-warn-soft",
        ].join(" ")}
      >
        <Scout alert={malicious} size={78} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2.5 py-0.5 text-[12px] font-bold uppercase tracking-wide ${
                malicious ? "bg-bad text-white" : "bg-warn text-white"
              }`}
            >
              {detection.verdict}
            </span>
            <span className="rounded-md bg-card px-1.5 py-0.5 text-[12px] font-medium text-ink-2 ring-1 ring-line">
              {detection.ecosystem}
            </span>
            {detection.mitre.slice(0, 4).map((t) => (
              <span
                key={t}
                className="rounded-md bg-card px-1.5 py-0.5 font-mono text-[11.5px] text-ink-2 ring-1 ring-line"
              >
                {t}
              </span>
            ))}
          </div>
          <h2 className="mt-2 truncate font-mono text-[22px] font-semibold leading-tight text-ink">
            {detection.package}
            <span className="font-normal text-ink-3">@{detection.version}</span>
          </h2>
          <p className="mt-1 text-[14px] leading-snug text-ink-2">{detection.summary}</p>
        </div>
        <div className="shrink-0 text-right">
          <div
            className={`text-[44px] font-bold leading-none tracking-tight tabular-nums ${
              malicious ? "text-bad" : "text-warn"
            }`}
          >
            {detection.score}
          </div>
          <div className="mt-1 text-[12px] font-medium text-ink-3">risk score</div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Guild agent */}
        <section data-section="agent" className="border-b border-line px-6 py-5">
          <div className="mb-3 flex items-center gap-2">
            <span className="grid h-6 w-6 place-items-center rounded-md bg-ink text-[12px] font-bold text-white">
              G
            </span>
            <span className="text-[14px] font-semibold text-ink">Guild triage agent</span>
            {agent?.confidence ? (
              <span className="ml-auto rounded-full bg-sunken px-2.5 py-0.5 text-[12px] font-medium text-ink-2 ring-1 ring-line">
                {agent.confidence.toLowerCase()} confidence
              </span>
            ) : null}
          </div>

          {agent ? (
            <>
              <div className="flex items-start gap-3">
                {agent.label ? (
                  <span
                    className={`mt-0.5 shrink-0 rounded-md px-2 py-0.5 text-[12px] font-bold ${
                      AGENT_TONE[agent.label] ?? "bg-ink text-white"
                    }`}
                  >
                    {agent.label}
                  </span>
                ) : null}
                <p className="text-[15px] font-medium leading-snug text-ink">
                  <Inline text={agent.sentence} />
                </p>
              </div>

              {agent.why.length > 0 ? (
                <ul className="mt-3.5 space-y-2">
                  {agent.why.slice(0, 4).map((reason, i) => (
                    <li key={i} className="flex gap-2.5 text-[13.5px] leading-relaxed text-ink-2">
                      <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-ink-3" />
                      <span>
                        <Inline text={reason} />
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}

              {detection.agentActions.length > 0 ? (
                <div className="mt-4">
                  <div className="mb-2 text-[12.5px] font-semibold text-ink-2">Recommended actions</div>
                  <div className="flex flex-wrap gap-2">
                    {detection.agentActions.slice(0, 5).map((action) => (
                      <span
                        key={action}
                        className="rounded-lg bg-brand-soft px-2.5 py-1.5 text-[13px] leading-snug text-ink"
                      >
                        <Inline text={action} />
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-[14px] text-ink-3">
              Waiting for the agent. Run{" "}
              <code className="rounded bg-sunken px-1 font-mono text-[13px]">beagle triage</code>.
            </p>
          )}
        </section>

        {/* Evidence */}
        <section data-section="evidence" className="px-6 py-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[14px] font-semibold text-ink">Evidence</span>
            <span className="text-[13px] text-ink-3">
              {findings.length} finding{findings.length === 1 ? "" : "s"} · Semgrep
            </span>
          </div>
          <div className="space-y-3">
            {findings.map((finding, index) => (
              <div
                key={`${finding.ruleId}-${finding.file}-${finding.line}-${index}`}
                className="overflow-hidden rounded-xl bg-code"
              >
                <div className="flex items-center gap-2 border-b border-code-line px-4 py-2">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      finding.severity === "error" ? "bg-[#ff6b6b]" : "bg-[#f6b24e]"
                    }`}
                  />
                  <span className="font-mono text-[12.5px] font-semibold text-code-text">
                    {finding.ruleId}
                  </span>
                  <span className="ml-auto truncate font-mono text-[12px] text-code-dim">
                    {finding.file}
                    {finding.line > 0 ? `:${finding.line}` : ""}
                  </span>
                </div>
                {finding.snippet ? (
                  <pre className="overflow-x-auto px-4 py-3 font-mono text-[13px] leading-[1.6] text-code-text">
                    {finding.snippet.trim().slice(0, 520)}
                  </pre>
                ) : null}
                <div className="border-t border-code-line px-4 py-2 text-[12.5px] leading-snug text-code-dim">
                  {finding.message}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
