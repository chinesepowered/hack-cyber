type Tone = "neutral" | "good" | "warn" | "bad" | "brand";

const TONE: Record<Tone, string> = {
  neutral: "text-ink",
  good: "text-good",
  warn: "text-warn",
  bad: "text-bad",
  brand: "text-brand",
};

/** One cell of the KPI strip. Rendered inside a shared card with dividers. */
export default function StatTile({
  label,
  value,
  unit,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  unit?: string;
  hint?: string;
  tone?: Tone;
}) {
  return (
    <div className="min-w-0 px-5 py-4">
      <div className="text-[13px] font-medium text-ink-2">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className={`text-[32px] leading-none font-semibold tracking-tight tabular-nums ${TONE[tone]}`}>
          {typeof value === "number" ? value.toLocaleString() : value}
        </span>
        {unit ? <span className="text-[15px] font-medium text-ink-3">{unit}</span> : null}
      </div>
      {hint ? <div className="mt-1.5 truncate text-[12.5px] text-ink-3">{hint}</div> : null}
    </div>
  );
}
