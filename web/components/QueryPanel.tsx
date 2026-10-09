"use client";

import { useCallback, useEffect, useState } from "react";

type Preset = { key: string; label: string; question: string; sql: string };

type Result = {
  sql: string;
  columns: string[];
  rows: Record<string, unknown>[];
  elapsedMs: number;
  rowsRead: number;
  bytesRead: number;
};

function human(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

export default function QueryPanel() {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [active, setActive] = useState<string>("");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = useCallback(async (key: string) => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ preset: key }),
      });
      const payload = await response.json();
      if (!payload.ok) throw new Error(payload.error ?? "query failed");
      setResult(payload as Result);
      setActive(key);
    } catch (err) {
      setError(err instanceof Error ? err.message : "query failed");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/query");
      const payload = await response.json();
      if (payload.ok && payload.presets?.length) {
        setPresets(payload.presets);
        void run(payload.presets[0].key);
      }
    })();
  }, [run]);

  const question = presets.find((p) => p.key === active)?.question;

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-panel">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
          ClickHouse
        </h2>
        <div className="flex flex-wrap gap-1.5">
          {presets.map((preset) => (
            <button
              key={preset.key}
              onClick={() => void run(preset.key)}
              disabled={busy}
              className={[
                "rounded border px-2 py-1 text-[10.5px] transition-colors disabled:opacity-50",
                active === preset.key
                  ? "border-tan/60 bg-tan/15 text-tan"
                  : "border-line bg-panel-2 text-muted hover:border-tan/40 hover:text-cream",
              ].join(" ")}
            >
              {preset.label}
            </button>
          ))}
        </div>
        {result ? (
          <div className="ml-auto flex items-center gap-3 font-mono text-[10px]">
            <span className="text-muted">
              {human(result.rowsRead)} rows scanned
            </span>
            <span className="rounded bg-teal/15 px-1.5 py-0.5 font-semibold text-teal">
              {result.elapsedMs} ms
            </span>
          </div>
        ) : null}
      </div>

      {question ? (
        <div className="border-b border-line/60 px-4 py-1.5 text-[11px] italic text-muted">
          {question}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,260px)_1fr]">
        <pre className="overflow-auto border-b border-line bg-ink px-3 py-2.5 font-mono text-[10px] leading-[1.6] text-tan/85 lg:border-b-0 lg:border-r">
          {result?.sql ?? "..."}
        </pre>

        <div className="min-h-0 overflow-auto">
          {error ? (
            <div className="px-4 py-3 font-mono text-[11px] text-alert">{error}</div>
          ) : result && result.rows.length > 0 ? (
            <table className="w-full border-collapse text-[11.5px]">
              <thead className="sticky top-0 bg-panel-2">
                <tr>
                  {result.columns.map((column) => (
                    <th
                      key={column}
                      className="border-b border-line px-3 py-1.5 text-left font-mono text-[10px] font-semibold uppercase tracking-wide text-muted"
                    >
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, index) => (
                  <tr key={index} className="border-b border-line/40 hover:bg-panel-2">
                    {result.columns.map((column) => (
                      <td
                        key={column}
                        className="max-w-[260px] truncate px-3 py-1.5 font-mono text-cream/85"
                      >
                        {String(row[column] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="px-4 py-3 text-[11px] text-muted">
              {busy ? "running..." : "no rows"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
