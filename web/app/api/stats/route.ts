import { NextResponse } from "next/server";
import { num, query } from "@/lib/clickhouse";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [counters, scale, byEcosystem, topRules] = await Promise.all([
      query<{
        scanned: string;
        flagged: string;
        malicious: string;
        median_s: number;
        p95_s: number;
      }>(`
        SELECT
          count()                                        AS scanned,
          countIf(verdict != 'clean')                    AS flagged,
          countIf(verdict = 'malicious')                 AS malicious,
          round(median(latencyMillis) / 1000, 1)         AS median_s,
          round(quantile(0.95)(latencyMillis) / 1000, 1) AS p95_s
        FROM releases
      `),
      query<{ history: string; findings: string; events: string }>(`
        SELECT
          (SELECT count() FROM registry_history) AS history,
          (SELECT count() FROM findings)         AS findings,
          (SELECT count() FROM logs)             AS events
      `),
      query<{ ecosystem: string; c: string }>(`
        SELECT ecosystem, count() AS c FROM releases GROUP BY ecosystem ORDER BY c DESC
      `),
      query<{ ruleId: string; c: string }>(`
        SELECT ruleId, count() AS c
        FROM findings
        GROUP BY ruleId
        ORDER BY c DESC
        LIMIT 6
      `),
    ]);

    const row = counters.rows[0];
    return NextResponse.json({
      ok: true,
      scanned: num(row?.scanned),
      flagged: num(row?.flagged),
      malicious: num(row?.malicious),
      medianSeconds: num(row?.median_s),
      p95Seconds: num(row?.p95_s),
      registryHistory: num(scale.rows[0]?.history),
      findings: num(scale.rows[0]?.findings),
      events: num(scale.rows[0]?.events),
      byEcosystem: byEcosystem.rows.map((r) => ({
        ecosystem: r.ecosystem,
        count: num(r.c),
      })),
      topRules: topRules.rows.map((r) => ({ ruleId: r.ruleId, count: num(r.c) })),
      queryMs: Math.max(
        counters.elapsedMs,
        scale.elapsedMs,
        byEcosystem.elapsedMs,
        topRules.elapsedMs,
      ),
      rowsRead: counters.rowsRead + scale.rowsRead,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "query failed" },
      { status: 500 },
    );
  }
}
