import { BarChart3, Clock, Crosshair } from "lucide-react";
import { useState } from "react";
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
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const width = 1440;
  const height = 360;
  const left = 78;
  const right = 34;
  const top = 28;
  const bottom = 58;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const yGridTicks = Array.from({ length: 11 }, (_, index) => index * 10);
  const yLabelTicks = new Set([0, 20, 40, 60, 80, 100]);
  const xGridTicks = Array.from({ length: 11 }, (_, index) => index / 10);
  const xLabelTicks = new Set([0, 0.2, 0.4, 0.6, 0.8, 1]);
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
  const activePoint = activeModelId ? points.find((point) => point.row.modelId === activeModelId) : undefined;
  const tooltipLeft = activePoint ? clamp((activePoint.x / width) * 100, 8, 92) : 0;
  const tooltipTop = activePoint ? clamp((activePoint.y / height) * 100, 6, 94) : 0;
  const tooltipBelow = activePoint ? activePoint.y < top + 52 : false;

  return (
    <div className="scatter-chart" role="img" aria-label="Accuracy on the y axis and average latency on the x axis">
      <div className="scatter-chart__plot">
        <svg viewBox={`0 0 ${width} ${height}`}>
        <rect className="scatter-chart__best-zone" x={left} y={top} width={plotWidth / 2} height={plotHeight / 2} rx="6" />
        <text className="scatter-chart__best-label" x={left + 12} y={top + 24}>
          best zone
        </text>

        {yGridTicks.map((tick) => {
          const y = top + ((100 - tick) / 100) * plotHeight;
          return (
            <g key={tick}>
              <line
                className={yLabelTicks.has(tick) ? "scatter-chart__grid scatter-chart__grid--major" : "scatter-chart__grid"}
                x1={left}
                x2={left + plotWidth}
                y1={y}
                y2={y}
              />
              {yLabelTicks.has(tick) ? (
                <text className="scatter-chart__tick scatter-chart__tick--y" x={left - 10} y={y + 4}>
                  {tick}%
                </text>
              ) : null}
            </g>
          );
        })}

        {xGridTicks.map((tick) => {
          const x = left + tick * plotWidth;
          const latency = Math.round(maxLatency * tick);
          return (
            <g key={tick}>
              <line
                className={xLabelTicks.has(tick) ? "scatter-chart__grid scatter-chart__grid--major" : "scatter-chart__grid"}
                x1={x}
                x2={x}
                y1={top}
                y2={top + plotHeight}
              />
              {xLabelTicks.has(tick) ? (
                <text className="scatter-chart__tick" x={x} y={top + plotHeight + 24}>
                  {latency} ms
                </text>
              ) : null}
            </g>
          );
        })}

        <line className="scatter-chart__axis" x1={left} x2={left} y1={top} y2={top + plotHeight} />
        <line className="scatter-chart__axis" x1={left} x2={left + plotWidth} y1={top + plotHeight} y2={top + plotHeight} />

        <text className="scatter-chart__axis-label" x={left + plotWidth / 2} y={height - 10}>
          Average latency
        </text>
        <text className="scatter-chart__axis-label scatter-chart__axis-label--y" x={18} y={top + plotHeight / 2}>
          Accuracy
        </text>

        {points.map(({ row, x, y, color }) => (
          <g
            key={row.modelId}
            className="scatter-chart__point-hitbox"
            tabIndex={0}
            role="button"
            aria-label={`${row.modelId}: ${row.accuracy.toFixed(1)}% accuracy, ${Math.round(row.averageLatencyMs)} ms average latency`}
            onMouseEnter={() => setActiveModelId(row.modelId)}
            onMouseLeave={() => setActiveModelId((current) => (current === row.modelId ? null : current))}
            onFocus={() => setActiveModelId(row.modelId)}
            onBlur={() => setActiveModelId((current) => (current === row.modelId ? null : current))}
          >
            <circle className="scatter-chart__point-target" cx={x} cy={y} r="12" />
            <circle
              className={activeModelId === row.modelId ? "scatter-chart__point scatter-chart__point--active" : "scatter-chart__point"}
              cx={x}
              cy={y}
              r="4.5"
              fill={color}
            />
          </g>
        ))}
      </svg>
        {activePoint ? (
          <div
            className={tooltipBelow ? "scatter-chart__tooltip scatter-chart__tooltip--below" : "scatter-chart__tooltip"}
            style={{
              left: `${tooltipLeft}%`,
              top: `${tooltipTop}%`
            }}
          >
            <strong>{activePoint.row.modelId}</strong>
            <span>
              {activePoint.row.accuracy.toFixed(1)}% accuracy · {Math.round(activePoint.row.averageLatencyMs)} ms avg ·{" "}
              {activePoint.row.totalPrompts} prompts
            </span>
          </div>
        ) : null}
      </div>

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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
