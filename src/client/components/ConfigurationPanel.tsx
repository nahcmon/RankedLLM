import { RefreshCw, Server, SlidersHorizontal, Zap } from "lucide-react";
import type { LmStudioModel } from "../types";
import { StatusPill } from "./StatusPill";

interface ConfigurationPanelProps {
  serverBaseUrl: string;
  setServerBaseUrl: (value: string) => void;
  models: LmStudioModel[];
  modelId: string;
  setModelId: (value: string) => void;
  temperature: number;
  setTemperature: (value: number) => void;
  maxTokens: string;
  setMaxTokens: (value: string) => void;
  timeoutMs: number;
  setTimeoutMs: (value: number) => void;
  samples: number;
  setSamples: (value: number) => void;
  seed: string;
  setSeed: (value: string) => void;
  connectionMessage: string;
  connectionTone: "idle" | "success" | "warning" | "error" | "running";
  isBusy: boolean;
  onTestConnection: () => void;
  onRefreshModels: () => void;
}

export function ConfigurationPanel({
  serverBaseUrl,
  setServerBaseUrl,
  models,
  modelId,
  setModelId,
  temperature,
  setTemperature,
  maxTokens,
  setMaxTokens,
  timeoutMs,
  setTimeoutMs,
  samples,
  setSamples,
  seed,
  setSeed,
  connectionMessage,
  connectionTone,
  isBusy,
  onTestConnection,
  onRefreshModels
}: ConfigurationPanelProps) {
  return (
    <section className="panel config-panel" aria-labelledby="config-heading">
      <div className="panel__header">
        <div>
          <h2 id="config-heading">Configuration</h2>
          <p>LM Studio OpenAI-compatible endpoint</p>
        </div>
        <Server size={18} aria-hidden="true" />
      </div>

      <label className="field">
        <span>Base URL</span>
        <input
          value={serverBaseUrl}
          onChange={(event) => setServerBaseUrl(event.target.value)}
          spellCheck={false}
        />
      </label>

      <div className="button-row">
        <button type="button" className="secondary-button" onClick={onTestConnection} disabled={isBusy}>
          <Zap size={15} aria-hidden="true" />
          Test
        </button>
        <button type="button" className="secondary-button" onClick={onRefreshModels} disabled={isBusy}>
          <RefreshCw size={15} aria-hidden="true" />
          Models
        </button>
      </div>

      {connectionMessage ? (
        <StatusPill tone={connectionTone}>{connectionMessage}</StatusPill>
      ) : (
        <StatusPill tone="idle">Not tested</StatusPill>
      )}

      <label className="field">
        <span>Model</span>
        <select value={modelId} onChange={(event) => setModelId(event.target.value)}>
          <option value="">Select a loaded model</option>
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.id}
            </option>
          ))}
        </select>
      </label>

      <div className="panel__subhead">
        <SlidersHorizontal size={16} aria-hidden="true" />
        <h3>Advanced</h3>
      </div>

      <div className="field-grid">
        <label className="field">
          <span>Temperature</span>
          <input
            type="number"
            min="0"
            step="0.1"
            value={temperature}
            onChange={(event) => setTemperature(Number(event.target.value))}
          />
        </label>
        <label className="field">
          <span>Max tokens</span>
          <input
            type="number"
            min="1"
            placeholder="Default"
            value={maxTokens}
            onChange={(event) => setMaxTokens(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Timeout ms</span>
          <input
            type="number"
            min="1000"
            step="1000"
            value={timeoutMs}
            onChange={(event) => setTimeoutMs(Number(event.target.value))}
          />
        </label>
        <label className="field">
          <span>Samples</span>
          <input
            type="number"
            min="1"
            max="20"
            value={samples}
            onChange={(event) => setSamples(Number(event.target.value))}
          />
        </label>
      </div>

      <label className="field">
        <span>Seed</span>
        <input
          type="number"
          placeholder="Optional"
          value={seed}
          onChange={(event) => setSeed(event.target.value)}
        />
      </label>
    </section>
  );
}
