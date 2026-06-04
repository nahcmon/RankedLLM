import { BarChart3, Clock, Crosshair } from "lucide-react";
import type { RunSummary } from "../types";

interface ComparisonChartsProps {
  summaries: RunSummary[];
}

export function ComparisonCharts({ summaries }: ComparisonChartsProps) {
  const modelRows = aggregateByModel(summaries);
  const benchmarkRows = aggregateByModelBenchmark(summaries).slice(0, 10);
  const maxLatency = Math.max(1, ...modelRows.map((row) => row.averageLatencyMs));

  if (summaries.length === 0) {
    return null;
  }

  return (
    <div className="chart-grid" aria-label="Comparison charts">
      <section className="chart-panel">
        <div className="chart-panel__header">
          <BarChart3 size={16} aria-hidden="true" />
          <h3>Accuracy by model</h3>
        </div>
        <div className="bar-list">
          {modelRows.map((row) => (
            <div className="bar-row" key={row.modelId}>
              <span title={row.modelId}>{row.modelId}</span>
              <div className="bar-row__track">
                <div className="bar-row__fill" style={{ width: `${row.accuracy}%` }} />
              </div>
              <strong>{row.accuracy.toFixed(1)}%</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="chart-panel">
        <div className="chart-panel__header">
          <Clock size={16} aria-hidden="true" />
          <h3>Latency by model</h3>
        </div>
        <div className="bar-list">
          {modelRows.map((row) => (
            <div className="bar-row" key={row.modelId}>
              <span title={row.modelId}>{row.modelId}</span>
              <div className="bar-row__track">
                <div className="bar-row__fill bar-row__fill--latency" style={{ width: `${(row.averageLatencyMs / maxLatency) * 100}%` }} />
              </div>
              <strong>{Math.round(row.averageLatencyMs)} ms</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="chart-panel chart-panel--wide">
        <div className="chart-panel__header">
          <Crosshair size={16} aria-hidden="true" />
          <h3>Accuracy vs latency</h3>
        </div>
        <AccuracyLatencyChart summaries={summaries} />
      </section>

      <section className="chart-panel chart-panel--wide">
        <div className="chart-panel__header">
          <BarChart3 size={16} aria-hidden="true" />
          <h3>Model and benchmark matrix</h3>
        </div>
        <div className="matrix-list">
          {benchmarkRows.map((row) => (
            <div className="matrix-row" key={`${row.modelId}-${row.benchmarkId}`}>
              <span title={`${row.modelId} · ${row.benchmarkName}`}>{row.modelId}</span>
              <em>{row.benchmarkName}</em>
              <strong>{row.accuracy.toFixed(1)}%</strong>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function AccuracyLatencyChart({ summaries }: { summaries: RunSummary[] }) {
  const width = 720;
  const height = 292;
  const left = 58;
  const right = 22;
  const top = 18;
  const bottom = 42;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const modelRows = aggregateByModel(summaries);
  const maxLatency = Math.max(1, ...modelRows.map((row) => row.averageLatencyMs));
  const points = modelRows
    .map((row, index) => ({
      row,
      x: left + (row.averageLatencyMs / maxLatency) * plotWidth,
      y: top + ((100 - row.accuracy) / 100) * plotHeight,
      color: chartColor(index)
    }))
    .sort((a, b) => a.row.averageLatencyMs - b.row.averageLatencyMs);

  return (
    <div className="scatter-chart" role="img" aria-label="Accuracy on the y axis and average latency on the x axis">
      <svg viewBox={`0 0 ${width} ${height}`}>
        <rect className="scatter-chart__best-zone" x={left} y={top} width={plotWidth / 2} height={plotHeight / 2} rx="6" />
        <text className="scatter-chart__best-label" x={left + 10} y={top + 20}>
          best zone
        </text>

        {[0, 25, 50, 75, 100].map((tick) => {
          const y = top + ((100 - tick) / 100) * plotHeight;
          return (
            <g key={tick}>
              <line className="scatter-chart__grid" x1={left} x2={left + plotWidth} y1={y} y2={y} />
              <text className="scatter-chart__tick scatter-chart__tick--y" x={left - 10} y={y + 4}>
                {tick}%
              </text>
            </g>
          );
        })}

        {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
          const x = left + tick * plotWidth;
          const latency = Math.round(maxLatency * tick);
          return (
            <g key={tick}>
              <line className="scatter-chart__grid" x1={x} x2={x} y1={top} y2={top + plotHeight} />
              <text className="scatter-chart__tick" x={x} y={top + plotHeight + 24}>
                {latency} ms
              </text>
            </g>
          );
        })}

        <line className="scatter-chart__axis" x1={left} x2={left} y1={top} y2={top + plotHeight} />
        <line className="scatter-chart__axis" x1={left} x2={left + plotWidth} y1={top + plotHeight} y2={top + plotHeight} />

        <text className="scatter-chart__axis-label" x={left + plotWidth / 2} y={height - 6}>
          Average latency
        </text>
        <text className="scatter-chart__axis-label scatter-chart__axis-label--y" x={14} y={top + plotHeight / 2}>
          Accuracy
        </text>

        {points.map(({ row, x, y, color }) => (
          <g key={row.modelId}>
            <circle className="scatter-chart__point" cx={x} cy={y} r="4.5" fill={color} />
            <title>
              {row.modelId}: {row.accuracy.toFixed(1)}%, {Math.round(row.averageLatencyMs)} ms average, {row.totalPrompts} prompts
            </title>
          </g>
        ))}
      </svg>

      <div className="scatter-chart__legend">
        {points.map(({ row, color }) => (
          <span key={row.modelId}>
            <i style={{ backgroundColor: color }} aria-hidden="true" />
            {shortLabel(row.modelId)}
          </span>
        ))}
      </div>
    </div>
  );
}

function aggregateByModel(summaries: RunSummary[]): Array<{
  modelId: string;
  accuracy: number;
  averageLatencyMs: number;
  totalPrompts: number;
}> {
  const groups = new Map<string, { total: number; correct: number; latencyTotal: number; latencyCount: number }>();
  for (const summary of summaries) {
    const group = groups.get(summary.modelId) ?? { total: 0, correct: 0, latencyTotal: 0, latencyCount: 0 };
    group.total += summary.totalPrompts;
    group.correct += summary.correctPrompts;
    group.latencyTotal += summary.averageLatencyMs * summary.totalPrompts;
    group.latencyCount += summary.totalPrompts;
    groups.set(summary.modelId, group);
  }
  return [...groups.entries()]
    .map(([modelId, group]) => ({
      modelId,
      accuracy: group.total > 0 ? (group.correct / group.total) * 100 : 0,
      averageLatencyMs: group.latencyCount > 0 ? group.latencyTotal / group.latencyCount : 0,
      totalPrompts: group.total
    }))
    .sort((a, b) => b.accuracy - a.accuracy);
}

function aggregateByModelBenchmark(summaries: RunSummary[]): Array<{
  modelId: string;
  benchmarkId: string;
  benchmarkName: string;
  accuracy: number;
}> {
  return summaries
    .map((summary) => ({
      modelId: summary.modelId,
      benchmarkId: summary.benchmarkId,
      benchmarkName: summary.benchmarkName,
      accuracy: summary.accuracy
    }))
    .sort((a, b) => b.accuracy - a.accuracy);
}

function chartColor(index: number): string {
  return ["#0f8b8d", "#9a5b00", "#3558a8", "#a83f5f", "#4f7d2b", "#7955a5"][index % 6];
}

function shortLabel(value: string): string {
  return value.length > 22 ? `${value.slice(0, 19)}...` : value;
}
