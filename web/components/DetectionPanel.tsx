"use client";

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

function Chip({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "danger" | "warn" | "info";
}) {
  const tones = {
    muted: "border-line bg-panel-2 text-muted",
    danger: "border-alert/40 bg-alert/10 text-alert",
    warn: "border-gold/40 bg-gold/10 text-gold",
    info: "border-teal/40 bg-teal/10 text-teal",
  };
  return (
    <span
      className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export default function DetectionPanel({
  detection,
  findings,
}: {
  detection: Detection | null;
  findings: Finding[];
}) {
  if (!detection) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl border border-line bg-panel p-8 text-center">
        <Scout alert={false} size={110} caption="nothing on the nose yet" />
        <p className="max-w-[260px] text-xs leading-relaxed text-muted">
          Scout is working through the feed. The first flagged package opens here
          with the code that convicted it.
        </p>
      </div>
    );
  }

  const malicious = detection.verdict === "malicious";

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-panel">
      <div
        className={[
          "flex items-start gap-3 border-b px-4 py-3",
          malicious ? "border-alert/30 bg-alert/8" : "border-gold/25 bg-gold/6",
        ].join(" ")}
      >
        <Scout alert={malicious} size={64} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`rounded px-1.5 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-wider ${
                malicious ? "bg-alert text-white" : "bg-gold text-ink"
              }`}
            >
              {detection.verdict}
            </span>
            <span className="font-mono text-[10px] text-muted">
              {detection.ecosystem}
            </span>
            {detection.notified ? <Chip tone="info">notified</Chip> : null}
          </div>
          <h2 className="mt-1 truncate font-mono text-[15px] font-semibold text-cream">
            {detection.package}
            <span className="text-muted">@{detection.version}</span>
          </h2>
          <p className="mt-1 text-[11.5px] leading-snug text-muted">
            {detection.summary}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div
            className={`font-mono text-[30px] font-bold leading-none tabular-nums ${
              malicious ? "text-alert" : "text-gold"
            }`}
          >
            {detection.score}
          </div>
          <div className="text-[9px] uppercase tracking-[0.14em] text-muted">score</div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {(detection.mitre.length > 0 || detection.signalIds.length > 0) && (
          <div className="flex flex-wrap gap-1.5 border-b border-line px-4 py-2.5">
            {detection.mitre.map((technique) => (
              <Chip key={technique} tone="danger">
                {technique}
              </Chip>
            ))}
            {detection.signalIds.map((signal) => (
              <Chip key={signal} tone="warn">
                {signal}
              </Chip>
            ))}
          </div>
        )}

        {detection.agentVerdict ? (
          <div className="border-b border-line bg-teal/5 px-4 py-3">
            <div className="mb-1.5 flex items-center gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-teal">
                Guild agent
              </span>
            </div>
            <p className="text-[11.5px] leading-relaxed text-cream/90">
              {detection.agentVerdict}
            </p>
            {detection.agentActions.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {detection.agentActions.map((action) => (
                  <li
                    key={action}
                    className="flex items-start gap-1.5 text-[11px] text-muted"
                  >
                    <span className="mt-[3px] text-teal">&rarr;</span>
                    <span>{action}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <div className="px-4 py-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
            Evidence &middot; {findings.length} finding{findings.length === 1 ? "" : "s"}
          </div>
          <div className="space-y-2.5">
            {findings.map((finding, index) => (
              <div
                key={`${finding.ruleId}-${finding.file}-${finding.line}-${index}`}
                className="overflow-hidden rounded-lg border border-line bg-ink"
              >
                <div className="flex items-center gap-2 border-b border-line px-2.5 py-1.5">
                  <span
                    className={`font-mono text-[10px] font-semibold ${
                      finding.severity === "error" ? "text-alert" : "text-gold"
                    }`}
                  >
                    {finding.ruleId}
                  </span>
                  <span className="rounded bg-panel-2 px-1 py-0.5 font-mono text-[9px] text-muted">
                    {finding.engine}
                  </span>
                  <span className="ml-auto truncate font-mono text-[10px] text-muted">
                    {finding.file}
                    {finding.line > 0 ? `:${finding.line}` : ""}
                  </span>
                </div>
                {finding.snippet ? (
                  <pre className="overflow-x-auto px-2.5 py-2 font-mono text-[10.5px] leading-[1.55] text-cream/85">
                    {finding.snippet.trim().slice(0, 460)}
                  </pre>
                ) : null}
                <div className="border-t border-line/60 px-2.5 py-1.5 text-[10.5px] leading-snug text-muted">
                  {finding.message}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
