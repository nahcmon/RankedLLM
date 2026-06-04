import { Download, Filter, History } from "lucide-react";
import { useMemo, useState } from "react";
import type { RunSummary } from "../types";
import { ComparisonCharts } from "./ComparisonCharts";

interface HistoryPageProps {
  summaries: RunSummary[];
}

interface HistoryFilters {
  runId: string;
  modelId: string;
  benchmarkId: string;
  date: string;
}

export function HistoryPage({ summaries }: HistoryPageProps) {
  const [filters, setFilters] = useState<HistoryFilters>({
    runId: "",
    modelId: "",
    benchmarkId: "",
    date: ""
  });

  const filterOptions = useMemo(() => {
    return {
      models: unique(summaries.map((summary) => summary.modelId)),
      benchmarks: unique(summaries.map((summary) => summary.benchmarkId))
    };
  }, [summaries]);

  const filteredSummaries = summaries.filter((summary) => {
    const date = summary.timestamp.slice(0, 10);
    return (
      (!filters.runId || summary.runId.toLowerCase().includes(filters.runId.toLowerCase())) &&
      (!filters.modelId || summary.modelId === filters.modelId) &&
      (!filters.benchmarkId || summary.benchmarkId === filters.benchmarkId) &&
      (!filters.date || date === filters.date)
    );
  });

  const groups = groupByRun(filteredSummaries);

  return (
    <section className="panel history-panel" aria-labelledby="history-heading">
      <div className="panel__header">
        <div>
          <h2 id="history-heading">History</h2>
          <p>Runs loaded from results.csv</p>
        </div>
        <a className="secondary-button" href="/api/results.csv" download>
          <Download size={15} aria-hidden="true" />
          CSV
        </a>
      </div>

      <ComparisonCharts summaries={filteredSummaries} />

      <div className="filter-bar" aria-label="History filters">
        <Filter size={16} aria-hidden="true" />
        <input
          placeholder="Run ID"
          value={filters.runId}
          onChange={(event) => setFilters({ ...filters, runId: event.target.value })}
        />
        <select
          value={filters.modelId}
          onChange={(event) => setFilters({ ...filters, modelId: event.target.value })}
        >
          <option value="">All models</option>
          {filterOptions.models.map((modelId) => (
            <option key={modelId} value={modelId}>
              {modelId}
            </option>
          ))}
        </select>
        <select
          value={filters.benchmarkId}
          onChange={(event) => setFilters({ ...filters, benchmarkId: event.target.value })}
        >
          <option value="">All benchmarks</option>
          {filterOptions.benchmarks.map((benchmarkId) => (
            <option key={benchmarkId} value={benchmarkId}>
              {benchmarkId}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={filters.date}
          onChange={(event) => setFilters({ ...filters, date: event.target.value })}
        />
      </div>

      {groups.length === 0 ? (
        <div className="empty-state empty-state--large">
          <History size={18} aria-hidden="true" />
          No matching runs.
        </div>
      ) : (
        <div className="history-groups">
          {groups.map((group) => (
            <article className="run-group" key={group.runId}>
              <header className="run-group__header">
                <div>
                  <strong>{group.runId}</strong>
                  <span>{formatDate(group.timestamp)}</span>
                </div>
                <div>
                  <span>{group.modelId}</span>
                  <span>{group.serverBaseUrl}</span>
                </div>
              </header>

              <div className="history-table" role="table">
                <div className="history-table__row history-table__row--head" role="row">
                  <span>Benchmark</span>
                  <span>Total</span>
                  <span>Correct</span>
                  <span>Accuracy</span>
                  <span>Avg latency</span>
                  <span>Errors</span>
                </div>
                {group.summaries.map((summary) => (
                  <div className="history-table__row" role="row" key={`${summary.runId}-${summary.benchmarkId}`}>
                    <span>
                      <strong>{summary.benchmarkName}</strong>
                      <em>{summary.benchmarkCategory}</em>
                    </span>
                    <span>{summary.totalPrompts}</span>
                    <span>{summary.correctPrompts}</span>
                    <span>{summary.accuracy.toFixed(1)}%</span>
                    <span>{Math.round(summary.averageLatencyMs)} ms</span>
                    <span className={summary.errors > 0 ? "error-text" : undefined}>{summary.errors}</span>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function groupByRun(summaries: RunSummary[]): Array<{
  runId: string;
  timestamp: string;
  modelId: string;
  serverBaseUrl: string;
  summaries: RunSummary[];
}> {
  const groups = new Map<string, RunSummary[]>();
  for (const summary of summaries) {
    const rows = groups.get(summary.runId) ?? [];
    rows.push(summary);
    groups.set(summary.runId, rows);
  }
  return [...groups.entries()].map(([runId, rows]) => ({
    runId,
    timestamp: rows[0]?.timestamp ?? "",
    modelId: rows[0]?.modelId ?? "",
    serverBaseUrl: rows[0]?.serverBaseUrl ?? "",
    summaries: rows
  }));
}

function formatDate(timestamp: string): string {
  if (!timestamp) {
    return "";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(timestamp));
}
