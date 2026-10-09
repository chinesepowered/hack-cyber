import { NextResponse } from "next/server";
import { query } from "@/lib/clickhouse";

export const dynamic = "force-dynamic";

/**
 * Preset analyst queries, in demo order.
 *
 * The first one deliberately scans the entire registry history table so the
 * latency on screen is a real full-table aggregate over millions of rows,
 * not a primary-key lookup of ten.
 */
export const PRESETS: Record<string, { label: string; question: string; sql: string }> = {
  registry_scale: {
    label: "Registry scale",
    question:
      "How much real npm history is in here, and how fast can we aggregate all of it?",
    sql: `SELECT
  count()                AS change_events,
  uniqExact(package)     AS distinct_packages,
  countIf(deleted = 1)   AS removals,
  max(seq)               AS highest_sequence
FROM registry_history`,
  },
  worst_offenders: {
    label: "What Scout barked at",
    question: "Every package that scored above the threshold, worst first.",
    sql: `SELECT package, version, score, verdict,
       arrayStringConcat(ruleIds, ', ') AS rules
FROM releases
WHERE verdict != 'clean'
ORDER BY score DESC, scannedAt DESC
LIMIT 10`,
  },
  rule_frequency: {
    label: "Detection mix",
    question: "Which rules are actually earning their place?",
    sql: `SELECT ruleId, engine, count() AS hits, max(weight) AS weight
FROM findings
GROUP BY ruleId, engine
ORDER BY hits DESC
LIMIT 10`,
  },
  takedowns: {
    label: "Registry takedowns",
    question:
      "Which packages were deleted from npm? Removal is what a takedown looks like in the feed.",
    sql: `SELECT package, max(seq) AS last_seq, count() AS events
FROM registry_history
WHERE deleted = 1
GROUP BY package
ORDER BY last_seq DESC
LIMIT 10`,
  },
  install_hooks: {
    label: "Install-time execution",
    question: "Which scanned packages run code during install, and did they score?",
    sql: `SELECT package, version, score, verdict, fileCount
FROM releases
WHERE hasInstallScript = 1
ORDER BY score DESC, scannedAt DESC
LIMIT 10`,
  },
  publisher_cadence: {
    label: "Release churn",
    question: "Which packages churn hardest across the whole history?",
    sql: `SELECT package, count() AS revisions, countIf(deleted = 1) AS removals
FROM registry_history
GROUP BY package
ORDER BY revisions DESC
LIMIT 10`,
  },
};

export async function GET() {
  return NextResponse.json({
    ok: true,
    presets: Object.entries(PRESETS).map(([key, value]) => ({
      key,
      label: value.label,
      question: value.question,
      sql: value.sql,
    })),
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { preset?: string; sql?: string };
    let sql = "";

    if (body.preset && PRESETS[body.preset]) {
      sql = PRESETS[body.preset].sql;
    } else if (body.sql) {
      const candidate = body.sql.trim().replace(/;+\s*$/, "");
      // readonly=1 is enforced on the connection too; this is the first of
      // two gates, so a typo in the panel cannot touch data.
      if (!/^(select|with)\b/i.test(candidate)) {
        return NextResponse.json(
          { ok: false, error: "only SELECT and WITH queries are allowed" },
          { status: 400 },
        );
      }
      if (/\b(insert|alter|drop|create|truncate|attach|detach|rename|grant)\b/i.test(candidate)) {
        return NextResponse.json({ ok: false, error: "statement rejected" }, { status: 400 });
      }
      sql = candidate;
    } else {
      return NextResponse.json({ ok: false, error: "no query supplied" }, { status: 400 });
    }

    const result = await query<Record<string, unknown>>(sql);
    const columns = result.rows.length > 0 ? Object.keys(result.rows[0]) : [];

    return NextResponse.json({
      ok: true,
      sql,
      columns,
      rows: result.rows.slice(0, 25),
      elapsedMs: result.elapsedMs,
      rowsRead: result.rowsRead,
      bytesRead: result.bytesRead,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "query failed" },
      { status: 500 },
    );
  }
}
