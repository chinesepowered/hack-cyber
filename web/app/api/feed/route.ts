import { NextResponse } from "next/server";
import { num, query } from "@/lib/clickhouse";

export const dynamic = "force-dynamic";

export type FeedRow = {
  scannedAt: string;
  ecosystem: string;
  package: string;
  version: string;
  score: number;
  verdict: string;
  ruleIds: string[];
  fileCount: number;
  scanMillis: number;
};

export async function GET(request: Request) {
  const limit = Math.min(
    Number(new URL(request.url).searchParams.get("limit") ?? 40) || 40,
    200,
  );

  try {
    const result = await query<Record<string, unknown>>(
      `
      SELECT
        formatDateTime(scannedAt, '%H:%i:%S') AS scannedAt,
        ecosystem, package, version, score, verdict, ruleIds, fileCount, scanMillis
      FROM releases
      ORDER BY scannedAt DESC
      LIMIT {limit:UInt32}
      `,
      { limit },
    );

    const rows: FeedRow[] = result.rows.map((r) => ({
      scannedAt: String(r.scannedAt ?? ""),
      ecosystem: String(r.ecosystem ?? ""),
      package: String(r.package ?? ""),
      version: String(r.version ?? ""),
      score: num(r.score),
      verdict: String(r.verdict ?? "clean"),
      ruleIds: (r.ruleIds as string[]) ?? [],
      fileCount: num(r.fileCount),
      scanMillis: num(r.scanMillis),
    }));

    return NextResponse.json({ ok: true, rows, queryMs: result.elapsedMs });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "query failed" },
      { status: 500 },
    );
  }
}
