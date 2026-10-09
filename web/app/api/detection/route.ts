import { NextResponse } from "next/server";
import { num, query } from "@/lib/clickhouse";

export const dynamic = "force-dynamic";

/**
 * The most recent detection, with its findings. When `package` is supplied
 * the dashboard is pinning a specific one (the operator clicked a row).
 */
export async function GET(request: Request) {
  const wanted = new URL(request.url).searchParams.get("package");

  try {
    const detection = await query<Record<string, unknown>>(
      wanted
        ? `SELECT detectedAt, ecosystem, package, version, publisher, score, severity,
                  verdict, ruleIds, signalIds, mitreAttacks, summary, agentVerdict,
                  agentActions, notificationNames
           FROM detections WHERE package = {pkg:String}
           ORDER BY detectedAt DESC LIMIT 1`
        : `SELECT detectedAt, ecosystem, package, version, publisher, score, severity,
                  verdict, ruleIds, signalIds, mitreAttacks, summary, agentVerdict,
                  agentActions, notificationNames
           FROM detections ORDER BY detectedAt DESC LIMIT 1`,
      wanted ? { pkg: wanted } : {},
    );

    const row = detection.rows[0];
    if (!row) {
      return NextResponse.json({ ok: true, detection: null, findings: [] });
    }

    const findings = await query<Record<string, unknown>>(
      `
      SELECT ruleId, engine, severity, weight, file, line, snippet, message
      FROM findings
      WHERE package = {pkg:String} AND version = {ver:String}
      ORDER BY weight DESC
      LIMIT 12
      `,
      { pkg: String(row.package), ver: String(row.version) },
    );

    return NextResponse.json({
      ok: true,
      detection: {
        detectedAt: String(row.detectedAt ?? ""),
        ecosystem: String(row.ecosystem ?? ""),
        package: String(row.package ?? ""),
        version: String(row.version ?? ""),
        publisher: String(row.publisher ?? ""),
        score: num(row.score),
        severity: String(row.severity ?? ""),
        verdict: String(row.verdict ?? ""),
        ruleIds: (row.ruleIds as string[]) ?? [],
        signalIds: (row.signalIds as string[]) ?? [],
        mitre: (row.mitreAttacks as string[]) ?? [],
        summary: String(row.summary ?? ""),
        agentVerdict: String(row.agentVerdict ?? ""),
        agentActions: (row.agentActions as string[]) ?? [],
        notified: ((row.notificationNames as string[]) ?? []).length > 0,
      },
      findings: findings.rows.map((f) => ({
        ruleId: String(f.ruleId ?? ""),
        engine: String(f.engine ?? ""),
        severity: String(f.severity ?? ""),
        weight: num(f.weight),
        file: String(f.file ?? ""),
        line: num(f.line),
        snippet: String(f.snippet ?? ""),
        message: String(f.message ?? ""),
      })),
      queryMs: detection.elapsedMs + findings.elapsedMs,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "query failed" },
      { status: 500 },
    );
  }
}
