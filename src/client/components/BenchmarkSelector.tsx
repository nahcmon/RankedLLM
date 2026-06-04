import { AlertTriangle, Check, Code2, FlaskConical } from "lucide-react";
import type { BenchmarkDefinition } from "../types";

interface BenchmarkSelectorProps {
  benchmarks: BenchmarkDefinition[];
  selectedIds: string[];
  samples: number;
  isRunning: boolean;
  enableCodeExecution: boolean;
  onToggle: (benchmarkId: string) => void;
  onCodeExecutionChange: (enabled: boolean) => void;
  onRun: () => void;
}

export function BenchmarkSelector({
  benchmarks,
  selectedIds,
  samples,
  isRunning,
  enableCodeExecution,
  onToggle,
  onCodeExecutionChange,
  onRun
}: BenchmarkSelectorProps) {
  const selectedPromptCount = benchmarks
    .filter((benchmark) => selectedIds.includes(benchmark.id))
    .filter((benchmark) => !benchmark.requiresCodeExecution || enableCodeExecution)
    .reduce((sum, benchmark) => sum + benchmark.promptCount * samples, 0);

  return (
    <section className="panel benchmarks-panel" aria-labelledby="benchmarks-heading">
      <div className="panel__header">
        <div>
          <h2 id="benchmarks-heading">Benchmarks</h2>
          <p>Local benchmark subsets</p>
        </div>
        <FlaskConical size={18} aria-hidden="true" />
      </div>

      <div className="benchmark-grid">
        {benchmarks.map((benchmark) => {
          const selected = selectedIds.includes(benchmark.id);
          const Icon = benchmark.requiresCodeExecution ? Code2 : FlaskConical;
          const locked = benchmark.requiresCodeExecution && !enableCodeExecution;
          return (
            <button
              type="button"
              key={benchmark.id}
              className={`benchmark-card ${selected ? "benchmark-card--selected" : ""}`}
              onClick={() => benchmark.enabled && !locked && onToggle(benchmark.id)}
              disabled={!benchmark.enabled || locked || isRunning}
              aria-pressed={selected}
            >
              <span className="benchmark-card__check" aria-hidden="true">
                {selected ? <Check size={15} /> : <Icon size={15} />}
              </span>
              <span className="benchmark-card__body">
                <span className="benchmark-card__name">{benchmark.name}</span>
                <span className="benchmark-card__meta">
                  {benchmark.promptCount} prompts · {benchmark.answerType.replace("_", " ")}
                </span>
                <span className="benchmark-card__description">{benchmark.description}</span>
                {benchmark.requiresCodeExecution ? (
                  <span className="benchmark-card__warning">
                    <AlertTriangle size={13} aria-hidden="true" />
                    {enableCodeExecution ? "Requires server Docker sandbox" : "Code execution disabled"}
                  </span>
                ) : !benchmark.enabled ? (
                  <span className="benchmark-card__warning">
                    <AlertTriangle size={13} aria-hidden="true" />
                    Disabled
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>

      <div className="run-strip">
        <div>
          <span className="run-strip__label">Estimated prompts</span>
          <strong>{selectedPromptCount}</strong>
        </div>
        <label className="code-toggle">
          <input
            type="checkbox"
            checked={enableCodeExecution}
            onChange={(event) => onCodeExecutionChange(event.target.checked)}
            disabled={isRunning}
          />
          <span>Enable code tests</span>
        </label>
        <button type="button" className="primary-button" onClick={onRun} disabled={isRunning || selectedPromptCount === 0}>
          Run selected
        </button>
      </div>
    </section>
  );
}
