import { Activity, AlertCircle, Clock, Target } from "lucide-react";
import type { ReactNode } from "react";
import type { PromptResultRow, RunProgress } from "../types";
import { StatusPill } from "./StatusPill";

interface LiveRunPanelProps {
  progress?: RunProgress;
  recentResults: PromptResultRow[];
}

export function LiveRunPanel({ progress, recentResults }: LiveRunPanelProps) {
  const percent = progress && progress.totalPrompts > 0
    ? Math.round((progress.completedPrompts / progress.totalPrompts) * 100)
    : 0;
  const accuracy = progress && progress.completedPrompts > 0
    ? Math.round((progress.correctPrompts / progress.completedPrompts) * 100)
    : 0;
  const tone = progress?.status === "completed" ? "success" : progress?.status === "running" ? "running" : "idle";

  return (
    <section className="panel live-panel" aria-labelledby="live-heading">
      <div className="panel__header">
        <div>
          <h2 id="live-heading">Live run</h2>
          <p>Prompt-level progress and errors</p>
        </div>
        <StatusPill tone={tone}>{progress?.status ?? "idle"}</StatusPill>
      </div>

      <div className="progress-track" aria-label="Run progress">
        <div className="progress-track__fill" style={{ width: `${percent}%` }} />
      </div>

      <div className="metric-grid">
        <Metric icon={<Activity size={16} />} label="Progress" value={`${progress?.completedPrompts ?? 0}/${progress?.totalPrompts ?? 0}`} />
        <Metric icon={<Target size={16} />} label="Accuracy" value={`${accuracy}%`} />
        <Metric icon={<Clock size={16} />} label="Avg latency" value={`${Math.round(progress?.averageLatencyMs ?? 0)} ms`} />
        <Metric icon={<AlertCircle size={16} />} label="Errors" value={`${progress?.errors ?? 0}`} />
      </div>

      <div className="current-run">
        <div>
          <span>Benchmark</span>
          <strong>{progress?.currentBenchmark ?? "None"}</strong>
        </div>
        <div>
          <span>Prompt</span>
          <strong>{progress?.currentPromptId ?? "None"}</strong>
        </div>
      </div>

      {progress?.currentPromptPreview ? (
        <div className="prompt-preview prompt-preview--live">
          <div className="prompt-preview__header">
            <span>Live prompt preview</span>
            <strong>{progress.currentPromptPreview.answerType.replace("_", " ")}</strong>
          </div>
          <pre>{progress.currentPromptPreview.prompt}</pre>
          {progress.currentPromptPreview.choices.length > 0 ? (
            <div className="prompt-preview__choices">
              {progress.currentPromptPreview.choices.map((choice) => (
                <span key={choice.label}>
                  <strong>{choice.label}</strong> {choice.text}
                </span>
              ))}
            </div>
          ) : null}
          <div className="prompt-preview__expected">
            Expected: <strong>{progress.currentPromptPreview.expectedAnswer}</strong>
          </div>
        </div>
      ) : null}

      <div className="result-list">
        <div className="result-list__header">
          <span>Recent prompt results</span>
          <span>{recentResults.length}</span>
        </div>
        {recentResults.length === 0 ? (
          <div className="empty-state">No prompt rows yet.</div>
        ) : (
          recentResults.slice(0, 8).map((row) => (
            <div className="result-row" key={`${row.run_id}-${row.prompt_id}`}>
              <div>
                <strong>{row.prompt_id}</strong>
                <span>{row.benchmark_name}</span>
              </div>
              <div className="result-row__stats">
                <span className={row.error ? "error-text" : row.is_correct === "true" ? "success-text" : "muted-text"}>
                  {row.error ? "error" : row.is_correct === "true" ? "correct" : "miss"}
                </span>
                <span>{row.latency_ms} ms</span>
              </div>
              {row.error ? <p>{row.error}</p> : null}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="metric-card">
      <span className="metric-card__icon" aria-hidden="true">
        {icon}
      </span>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}
