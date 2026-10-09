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
  topRules: { ruleId: string; count: number }[];
};

const POLL_MS = 2500;

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
    const response = await fetch(url, { cache: "no-store" });
    const payload = await response.json();
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
        // While the operator has a row pinned, leave their panel alone.
        if (!pinnedRef.current) await loadDetection();
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
  const caught = stats ? stats.flagged : 0;

  return (
    <main className="mx-auto flex min-h-screen max-w-[1500px] flex-col gap-3 px-4 py-4 lg:h-screen lg:overflow-hidden">
      <header
        data-demo="header"
        className="flex flex-wrap items-center gap-4 rounded-xl border border-line bg-panel px-5 py-3"
      >
        <Scout alert={barking} size={62} />
        <div className="min-w-0">
          <h1 className="text-[19px] font-semibold leading-tight tracking-tight text-cream">
            Beagle Brigade
          </h1>
          <p className="text-[11.5px] text-muted">
            Scout sniffs every new npm and PyPI release for malware, in real time
          </p>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1.5 rounded-full border border-line bg-panel-2 px-2.5 py-1">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                online ? "bg-teal animate-pulse-dot" : "bg-alert"
              }`}
            />
            <span className="font-mono text-[10px] text-muted">
              {online ? "live" : "offline"}
            </span>
          </div>
          <span className="rounded-full border border-line bg-panel-2 px-2.5 py-1 font-mono text-[10px] text-muted">
            npm + PyPI
          </span>
          <span className="rounded-full border border-line bg-panel-2 px-2.5 py-1 font-mono text-[10px] text-muted">
            Semgrep
          </span>
          <span className="rounded-full border border-line bg-panel-2 px-2.5 py-1 font-mono text-[10px] text-muted">
            ClickHouse &middot; Tokyo
          </span>
        </div>
      </header>

      <section
        data-demo="stats"
        className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6"
      >
        <StatTile
          label="Packages sniffed"
          value={stats?.scanned ?? 0}
          hint="fetched, unpacked, analysed"
        />
        <StatTile
          label="Flagged"
          value={caught}
          tone={caught > 0 ? "warn" : "neutral"}
          hint="scored above threshold"
        />
        <StatTile
          label="Malicious"
          value={stats?.malicious ?? 0}
          tone={(stats?.malicious ?? 0) > 0 ? "danger" : "neutral"}
          hint="Scout barked"
        />
        <StatTile
          label="Publish to verdict"
          value={stats?.medianSeconds ?? 0}
          unit="s"
          tone="clean"
          hint="median, end to end"
        />
        <StatTile
          label="Registry history"
          value={stats?.registryHistory ?? 0}
          tone="neutral"
          hint="real npm change events"
        />
        <StatTile
          label="Stats query"
          value={stats?.queryMs ?? 0}
          unit="ms"
          tone="clean"
          hint="server-side, this refresh"
        />
      </section>

      <section className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div data-demo="feed" className="min-h-0">
          <LiveFeed rows={rows} selected={pinned} onSelect={onSelect} />
        </div>
        <div data-demo="detection" className="min-h-0">
          <DetectionPanel detection={detection} findings={findings} />
        </div>
      </section>

      <section data-demo="clickhouse" className="lg:h-[270px]">
        <QueryPanel />
      </section>
    </main>
  );
}
