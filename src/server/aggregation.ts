import type { PromptResultRow, RunSummary } from "./types.js";

export function aggregateRunSummaries(rows: PromptResultRow[]): RunSummary[] {
  const summaries = new Map<string, RunSummary & { latencyTotal: number; latencyCount: number }>();

  for (const row of rows) {
    const key = [
      row.run_id,
      row.timestamp,
      row.server_base_url,
      row.model_id,
      row.benchmark_id
    ].join("::");
    const existing = summaries.get(key);
    const score = Number(row.score || 0);
    const latency = Number(row.latency_ms || 0);
    const hasError = Boolean(row.error);
    const hasLatency = !hasError && Number.isFinite(latency) && latency > 0;

    const next = existing ?? {
      runId: row.run_id,
      timestamp: row.timestamp,
      serverBaseUrl: row.server_base_url,
      modelId: row.model_id,
      benchmarkId: row.benchmark_id,
      benchmarkName: row.benchmark_name,
      benchmarkCategory: row.benchmark_category,
      totalPrompts: 0,
      correctPrompts: 0,
      accuracy: 0,
      averageLatencyMs: 0,
      errors: 0,
      latencyTotal: 0,
      latencyCount: 0
    };

    next.errors += hasError ? 1 : 0;
    if (!hasError) {
      next.totalPrompts += 1;
      next.correctPrompts += score >= 1 ? 1 : 0;
    }
    if (hasLatency) {
      next.latencyTotal += latency;
      next.latencyCount += 1;
    }
    next.accuracy = next.totalPrompts > 0 ? (next.correctPrompts / next.totalPrompts) * 100 : 0;
    next.averageLatencyMs = next.latencyCount > 0 ? next.latencyTotal / next.latencyCount : 0;
    summaries.set(key, next);
  }

  return [...summaries.values()]
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .map(({ latencyTotal: _latencyTotal, latencyCount: _latencyCount, ...summary }) => summary);
}
