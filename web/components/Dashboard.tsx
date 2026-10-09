"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FeedRow } from "@/app/api/feed/route";
import DetectionPanel, { type Detection, type Finding } from "./DetectionPanel";
import LiveFeed from "./LiveFeed";
import QueryPanel from "./QueryPanel";
import Scout from "./Scout";
import StatTile from "./StatTile";

type Stats = {
  scanned: number;
  flagged: number;
  malicious: number;
  medianSeconds: number;
  registryHistory: number;
  findings: number;
  events: number;
  queryMs: number;
};

const POLL_MS = 2500;

function compact(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(0)}k`;
  return n.toLocaleString();
}

function Pill({ children, dot }: { children: React.ReactNode; dot?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-card px-3 py-1 text-[13px] font-medium text-ink-2 ring-1 ring-line">
      {dot ? <span className={`h-1.5 w-1.5 rounded-full ${dot}`} /> : null}
      {children}
    </span>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [rows, setRows] = useState<FeedRow[]>([]);
  const [detection, setDetection] = useState<Detection | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [pinned, setPinned] = useState<string | undefined>();
  const [online, setOnline] = useState(true);
  const pinnedRef = useRef<string | undefined>(undefined);
  pinnedRef.current = pinned;

  const loadDetection = useCallback(async (pkg?: string) => {
    const url = pkg ? `/api/detection?package=${encodeURIComponent(pkg)}` : "/api/detection";
    const payload = await fetch(url, { cache: "no-store" }).then((r) => r.json());
    if (payload.ok) {
      setDetection(payload.detection);
      setFindings(payload.findings ?? []);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const [statsRes, feedRes] = await Promise.all([
          fetch("/api/stats", { cache: "no-store" }).then((r) => r.json()),
          fetch("/api/feed?limit=60", { cache: "no-store" }).then((r) => r.json()),
        ]);
        if (cancelled) return;
        if (statsRes.ok) setStats(statsRes);
        if (feedRes.ok) setRows(feedRes.rows);
        setOnline(Boolean(statsRes.ok));
        // While a row is pinned, keep refreshing that one (so a Guild verdict
        // appears the moment triage finishes) instead of jumping to the
        // newest detection. lastIndexOf, not split: scoped names like
        // @opencode/cli start with "@".
        const id = pinnedRef.current;
        await loadDetection(id ? id.slice(0, id.lastIndexOf("@")) : undefined);
      } catch {
        if (!cancelled) setOnline(false);
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [loadDetection]);

  // Deep link: #pin=package@version opens a specific detection, even one that
  // has scrolled out of the live feed. Used for sharing and by the recorder.
  useEffect(() => {
    const apply = () => {
      const match = /pin=([^&]+)/.exec(window.location.hash);
      if (!match) return;
      const id = decodeURIComponent(match[1]);
      setPinned(id);
      void loadDetection(id.slice(0, id.lastIndexOf("@")));
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, [loadDetection]);

  const onSelect = useCallback(
    (row: FeedRow) => {
      const id = `${row.package}@${row.version}`;
      if (pinned === id) {
        setPinned(undefined);
        void loadDetection();
      } else {
        setPinned(id);
        void loadDetection(row.package);
      }
    },
    [pinned, loadDetection],
  );

  const barking = detection?.verdict === "malicious";

  return (
    <main className="mx-auto grid h-screen max-w-[1560px] grid-rows-[auto_auto_minmax(0,1fr)_236px] gap-4 px-6 py-5">
      {/* Header */}
      <header data-demo="header" className="flex items-center gap-4">
        <Scout alert={barking} size={52} />
        <div className="min-w-0">
          <h1 className="text-[24px] font-bold leading-tight tracking-tight text-ink">Beagle Brigade</h1>
          <p className="text-[14.5px] text-ink-2">
            Scout sniffs every new npm and PyPI release for malware, in real time.
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <Pill dot={online ? "bg-good animate-pulse-dot" : "bg-bad"}>{online ? "Live" : "Offline"}</Pill>
          <Pill>npm · PyPI</Pill>
          <Pill>Semgrep</Pill>
          <Pill>ClickHouse · Tokyo</Pill>
          <Pill>Guild</Pill>
        </div>
      </header>

      {/* KPI strip */}
      <section
        data-demo="stats"
        className="card grid grid-cols-2 divide-line md:grid-cols-5 md:divide-x"
      >
        <StatTile label="Packages sniffed" value={stats?.scanned ?? 0} hint="fetched, unpacked, analysed" />
        <StatTile
          label="Flagged"
          value={stats?.flagged ?? 0}
          tone={(stats?.flagged ?? 0) > 0 ? "warn" : "neutral"}
          hint="scored above threshold"
        />
        <StatTile
          label="Malicious"
          value={stats?.malicious ?? 0}
          tone={(stats?.malicious ?? 0) > 0 ? "bad" : "neutral"}
          hint="Scout barked"
        />
        <StatTile
          label="Registry history"
          value={compact(stats?.registryHistory ?? 0)}
          tone="brand"
          hint="real npm change events"
        />
        <StatTile
          label="Query latency"
          value={stats?.queryMs ?? 0}
          unit="ms"
          tone="good"
          hint="ClickHouse server-side"
        />
      </section>

      {/* Feed + detection */}
      <section className="grid min-h-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div data-demo="feed" className="min-h-0">
          <LiveFeed rows={rows} selected={pinned} onSelect={onSelect} />
        </div>
        <div data-demo="detection" className="min-h-0">
          <DetectionPanel detection={detection} findings={findings} />
        </div>
      </section>

      {/* ClickHouse */}
      <section data-demo="clickhouse" className="min-h-0">
        <QueryPanel />
      </section>
    </main>
  );
}
