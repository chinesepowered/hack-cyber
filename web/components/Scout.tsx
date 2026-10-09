"use client";

/**
 * Scout. Idle he sniffs; on a malicious detection he switches to the alert
 * pose and barks. The state change is the fastest signal on the page: you
 * can read it from the back of the room without reading anything.
 */
export default function Scout({
  alert,
  size = 120,
  ring = true,
}: {
  alert: boolean;
  size?: number;
  ring?: boolean;
}) {
  return (
    <div
      className={[
        "relative grid shrink-0 place-items-center rounded-full transition-colors duration-500",
        ring ? (alert ? "bg-bad-soft animate-ring" : "bg-brand-soft") : "",
      ].join(" ")}
      style={{ width: size + (ring ? 16 : 0), height: size + (ring ? 16 : 0) }}
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
  );
}
