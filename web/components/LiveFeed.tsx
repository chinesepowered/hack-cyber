"use client";

import type { FeedRow } from "@/app/api/feed/route";

const VERDICT = {
  malicious: {
    chip: "bg-alert text-white",
    text: "text-alert",
    label: "BARK",
    row: "bg-alert/8 hover:bg-alert/14",
  },
  suspicious: {
    chip: "bg-gold text-ink",
    text: "text-gold",
    label: "sniff",
    row: "bg-gold/6 hover:bg-gold/12",
  },
  clean: {
    chip: "bg-line text-muted",
    text: "text-muted",
    label: "ok",
    row: "hover:bg-panel-2",
  },
} as const;

function style(verdict: string) {
  return VERDICT[verdict as keyof typeof VERDICT] ?? VERDICT.clean;
}

export default function LiveFeed({
  rows,
  selected,
  onSelect,
}: {
  rows: FeedRow[];
  selected?: string;
  onSelect: (row: FeedRow) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-panel">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
          Live sniff feed
        </h2>
        <span className="font-mono text-[10px] text-muted">
          {rows.length} most recent
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-xs text-muted">
            Waiting for the first package. Run{" "}
            <code className="font-mono text-tan">beagle live</code> to start the feed.
          </div>
        ) : (
          <table className="w-full border-collapse text-[12.5px]">
            <tbody>
              {rows.map((row, index) => {
                const s = style(row.verdict);
                const id = `${row.package}@${row.version}`;
                const isSelected = selected === id;
                return (
                  <tr
                    key={`${id}-${row.scannedAt}-${index}`}
                    onClick={() => onSelect(row)}
                    className={[
                      "animate-row-in cursor-pointer border-b border-line/50 transition-colors",
                      s.row,
                      isSelected ? "outline outline-1 -outline-offset-1 outline-tan/60" : "",
                    ].join(" ")}
                    style={{ animationDelay: `${Math.min(index, 8) * 18}ms` }}
                  >
                    <td className="w-[62px] py-2 pl-3 pr-1">
                      <span
                        className={`inline-block w-full rounded px-1.5 py-0.5 text-center font-mono text-[9.5px] font-bold uppercase tracking-wide ${s.chip}`}
                      >
                        {s.label}
                      </span>
                    </td>
                    <td className="w-[46px] py-2 pr-2 font-mono text-[10px] text-muted">
                      {row.ecosystem}
                    </td>
                    <td className="py-2 pr-2">
                      <span className="font-mono text-cream">{row.package}</span>
                      <span className="font-mono text-muted">@{row.version}</span>
                    </td>
                    <td className="w-[54px] py-2 pr-2 text-right">
                      <span className={`font-mono text-[12px] font-semibold tabular-nums ${s.text}`}>
                        {row.score}
                      </span>
                    </td>
                    <td className="w-[74px] py-2 pr-3 text-right font-mono text-[10px] text-muted tabular-nums">
                      {row.scanMillis}ms
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
