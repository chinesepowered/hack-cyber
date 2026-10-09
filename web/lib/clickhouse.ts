import { config } from "dotenv";
import path from "node:path";

// Credentials live in the repo-root .env, shared with the Python scanner.
config({ path: path.resolve(process.cwd(), "..", ".env") });

const URL_BASE = (process.env.CLICKHOUSE_URL ?? "http://localhost:8123").replace(/\/$/, "");
const USER = process.env.CLICKHOUSE_USER ?? "default";
const PASSWORD = process.env.CLICKHOUSE_PASSWORD ?? "";
const DATABASE = process.env.CLICKHOUSE_DATABASE ?? "beagle";

export type QueryResult<T> = {
  rows: T[];
  elapsedMs: number;
  rowsRead: number;
  bytesRead: number;
};

/**
 * Run a read-only query. Returns the rows plus ClickHouse's own server-side
 * statistics, which is what the dashboard puts on screen: the latency number
 * should come from the database, not from a stopwatch around fetch().
 */
export async function query<T = Record<string, unknown>>(
  sql: string,
  params: Record<string, string | number> = {},
): Promise<QueryResult<T>> {
  const search = new URLSearchParams({
    database: DATABASE,
    default_format: "JSON",
    // Hard safety rail: the query panel is user-facing.
    readonly: "1",
    max_execution_time: "20",
  });
  for (const [key, value] of Object.entries(params)) {
    search.set(`param_${key}`, String(value));
  }

  const response = await fetch(`${URL_BASE}/?${search.toString()}`, {
    method: "POST",
    // Credentials in headers, never the query string: URLs end up in proxy
    // logs, access logs and error messages. The first version leaked them.
    headers: { "X-ClickHouse-User": USER, "X-ClickHouse-Key": PASSWORD },
    body: `${sql}\nFORMAT JSON`,
    cache: "no-store",
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(text.slice(0, 500));
  }

  const payload = JSON.parse(text);
  return {
    rows: (payload.data ?? []) as T[],
    elapsedMs: Math.round((payload.statistics?.elapsed ?? 0) * 1000 * 10) / 10,
    rowsRead: payload.statistics?.rows_read ?? 0,
    bytesRead: payload.statistics?.bytes_read ?? 0,
  };
}

export function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
