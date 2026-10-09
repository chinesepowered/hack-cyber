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

function cell(value: unknown): string {
  if (typeof value === "number") return value.toLocaleString();
  const text = String(value ?? "");
  return /^\d{4,}$/.test(text) ? Number(text).toLocaleString() : text;
}

export default function QueryPanel() {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [active, setActive] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = useCallback(async (key: string) => {
    setBusy(true);
    setError("");
    setActive(key);
    try {
      const response = await fetch("/api/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ preset: key }),
      });
      const payload = await response.json();
      if (!payload.ok) throw new Error(payload.error ?? "query failed");
      setResult(payload as Result);
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
    <div className="card flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-[#faff69] text-[11px] font-black text-ink ring-1 ring-black/10">
            CH
          </span>
          <h2 className="text-[15px] font-semibold text-ink">ClickHouse</h2>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {presets.map((preset) => (
            <button
              key={preset.key}
              onClick={() => void run(preset.key)}
              disabled={busy}
              className={[
                "rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors disabled:cursor-wait",
                active === preset.key
                  ? "bg-ink text-white"
                  : "bg-sunken text-ink-2 ring-1 ring-line hover:bg-card hover:text-ink",
              ].join(" ")}
            >
              {preset.label}
            </button>
          ))}
        </div>
        {result ? (
          <div className="ml-auto flex items-center gap-2.5">
            <span className="text-[13px] text-ink-2">
              <span className="font-semibold text-ink">{human(result.rowsRead)}</span> rows scanned
            </span>
            <span className="rounded-full bg-good px-3 py-1 font-mono text-[13px] font-semibold text-white tabular-nums">
              {result.elapsedMs} ms
            </span>
          </div>
        ) : null}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,330px)_1fr]">
        <div className="flex min-h-0 flex-col bg-code">
          {question ? (
            <div className="border-b border-code-line px-4 py-2.5 text-[13px] leading-snug text-code-dim">
              {question}
            </div>
          ) : null}
          <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-[12.5px] leading-[1.65] text-[#f6c48b]">
            {result?.sql ?? "..."}
          </pre>
        </div>

        <div className="min-h-0 overflow-auto">
          {error ? (
            <div className="px-5 py-4 font-mono text-[13px] text-bad">{error}</div>
          ) : result && result.rows.length > 0 ? (
            <table className="w-full border-collapse">
              <thead className="sticky top-0 bg-sunken">
                <tr>
                  {result.columns.map((column) => (
                    <th
                      key={column}
                      className="border-b border-line px-4 py-2 text-left text-[12px] font-semibold text-ink-2"
                    >
                      {column.replace(/_/g, " ")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, index) => (
                  <tr key={index} className="border-b border-line/70 hover:bg-sunken">
                    {result.columns.map((column) => (
                      <td
                        key={column}
                        className="max-w-[280px] truncate px-4 py-2 font-mono text-[13px] text-ink tabular-nums"
                      >
                        {cell(row[column])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="px-5 py-4 text-[14px] text-ink-3">{busy ? "Running…" : "No rows"}</div>
          )}
        </div>
      </div>
    </div>
  );
}
