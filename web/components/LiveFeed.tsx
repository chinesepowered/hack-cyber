"use client";

import type { FeedRow } from "@/app/api/feed/route";

const VERDICT = {
  malicious: {
    dot: "bg-bad",
    pill: "bg-bad text-white",
    label: "Malicious",
    row: "bg-bad-soft/70 hover:bg-bad-soft",
  },
  suspicious: {
    dot: "bg-warn",
    pill: "bg-warn-soft text-warn ring-1 ring-warn-line",
    label: "Suspicious",
    row: "hover:bg-sunken",
  },
  clean: {
    dot: "bg-good",
    pill: "bg-good-soft text-good ring-1 ring-good-line",
    label: "Clean",
    row: "hover:bg-sunken",
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
    <div className="card flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-good animate-pulse-dot" />
          <h2 className="text-[15px] font-semibold text-ink">Live feed</h2>
        </div>
        <span className="text-[13px] text-ink-3">newest first</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <div className="px-5 py-12 text-center text-[14px] text-ink-2">
            Waiting for the first package. Run{" "}
            <code className="rounded bg-sunken px-1.5 py-0.5 font-mono text-[13px] text-brand">
              beagle live
            </code>{" "}
            to start the feed.
          </div>
        ) : (
          <ul>
            {rows.map((row, index) => {
              const s = style(row.verdict);
              const id = `${row.package}@${row.version}`;
              const isSelected = selected === id;
              return (
                <li
                  key={`${id}-${row.scannedAt}-${index}`}
                  onClick={() => onSelect(row)}
                  className={[
                    "animate-row-in flex cursor-pointer items-center gap-3 border-b border-line/70 px-5 py-2.5 transition-colors",
                    s.row,
                    isSelected ? "shadow-[inset_3px_0_0_0_var(--color-brand)] bg-brand-soft/60" : "",
                  ].join(" ")}
                  style={{ animationDelay: `${Math.min(index, 8) * 16}ms` }}
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${s.dot}`} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-[14px] font-medium text-ink">
                      {row.package}
                      <span className="font-normal text-ink-3">@{row.version}</span>
                    </div>
                  </div>
                  <span className="shrink-0 rounded-md bg-sunken px-1.5 py-0.5 text-[12px] font-medium text-ink-2 ring-1 ring-line">
                    {row.ecosystem}
                  </span>
                  <span
                    className={`w-[118px] shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-center text-[12px] font-semibold ${s.pill}`}
                  >
                    {s.label} · {row.score}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
