"use client";

type Props = {
  alert: boolean;
  size?: number;
  caption?: string;
};

/**
 * Scout. Idle he sniffs; on a malicious detection he switches to the alert
 * pose and barks. The state change is the fastest signal on the page: you
 * can see it from the back of the room without reading anything.
 */
export default function Scout({ alert, size = 132, caption }: Props) {
  return (
    <div className="flex flex-col items-center gap-2 select-none">
      <div
        className={[
          "relative grid place-items-center rounded-full transition-colors duration-500",
          alert ? "bg-alert/10 animate-ring" : "bg-tan/5",
        ].join(" ")}
        style={{ width: size + 22, height: size + 22 }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={alert ? "/scout-alert.png" : "/scout.png"}
          alt={alert ? "Scout barking at a malicious package" : "Scout sniffing packages"}
          width={size}
          height={size}
          className={alert ? "animate-bark" : "animate-sniff"}
          style={{ width: size, height: size }}
        />
      </div>
      {caption ? (
        <span
          className={[
            "text-[11px] font-medium uppercase tracking-[0.14em]",
            alert ? "text-alert" : "text-muted",
          ].join(" ")}
        >
          {caption}
        </span>
      ) : null}
    </div>
  );
}
