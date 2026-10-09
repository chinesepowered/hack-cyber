type Tone = "neutral" | "clean" | "warn" | "danger";

const TONE: Record<Tone, { value: string; glow: string }> = {
  neutral: { value: "text-cream", glow: "from-tan/18" },
  clean: { value: "text-teal", glow: "from-teal/18" },
  warn: { value: "text-gold", glow: "from-gold/18" },
  danger: { value: "text-alert", glow: "from-alert/22" },
};

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
  const t = TONE[tone];
  return (
    <div className="relative overflow-hidden rounded-xl border border-line bg-panel px-4 py-3.5">
      <div
        className={`pointer-events-none absolute inset-x-0 -top-14 h-20 bg-gradient-to-b ${t.glow} to-transparent blur-xl`}
      />
      <div className="relative">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
          {label}
        </div>
        <div className="mt-1.5 flex items-baseline gap-1">
          <span
            className={`font-mono text-[26px] leading-none font-semibold tabular-nums ${t.value}`}
          >
            {typeof value === "number" ? value.toLocaleString() : value}
          </span>
          {unit ? <span className="text-xs text-muted">{unit}</span> : null}
        </div>
        {hint ? <div className="mt-1.5 text-[11px] text-muted">{hint}</div> : null}
      </div>
    </div>
  );
}
