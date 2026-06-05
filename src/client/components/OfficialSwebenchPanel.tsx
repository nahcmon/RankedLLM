import { ExternalLink, FileCode2, Play, ShieldAlert } from "lucide-react";
import type { ChangeEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchOfficialSuites, startOfficialEvaluationRun, startOfficialPredictionRun } from "../api";
import type { OfficialRunProgress, OfficialSuiteDefinition, OfficialSuiteId } from "../types";
import { StatusPill } from "./StatusPill";

interface OfficialSwebenchPanelProps {
  serverBaseUrl: string;
  modelId: string;
  temperature: number;
  timeoutMs: number;
  maxTokens: string;
}

type SourceType = "huggingface" | "inline_file";

export function OfficialSwebenchPanel({
  serverBaseUrl,
  modelId,
  temperature,
  timeoutMs,
  maxTokens
}: OfficialSwebenchPanelProps) {
  const [suites, setSuites] = useState<OfficialSuiteDefinition[]>([]);
  const [evaluationEnabled, setEvaluationEnabled] = useState(false);
  const [suiteId, setSuiteId] = useState<OfficialSuiteId>("swe_bench");
  const [sourceType, setSourceType] = useState<SourceType>("huggingface");
  const [datasetName, setDatasetName] = useState("");
  const [split, setSplit] = useState("");
  const [limit, setLimit] = useState("");
  const [instanceIds, setInstanceIds] = useState("");
  const [predictionOutputPath, setPredictionOutputPath] = useState("");
  const [localFile, setLocalFile] = useState<{ name: string; content: string }>();
  const [predictionsPath, setPredictionsPath] = useState("");
  const [evaluationRunId, setEvaluationRunId] = useState("");
  const [maxWorkers, setMaxWorkers] = useState("1");
  const [namespace, setNamespace] = useState("");
  const [proRepoPath, setProRepoPath] = useState("");
  const [rawSamplePath, setRawSamplePath] = useState("");
  const [scriptsDir, setScriptsDir] = useState("");
  const [evaluationOutputDir, setEvaluationOutputDir] = useState("");
  const [dockerhubUsername, setDockerhubUsername] = useState("jefzda");
  const [useLocalDocker, setUseLocalDocker] = useState(false);
  const [progress, setProgress] = useState<OfficialRunProgress>();
  const [status, setStatus] = useState("");
  const eventSourceRef = useRef<EventSource | null>(null);

  const selectedSuite = useMemo(
    () => suites.find((suite) => suite.id === suiteId),
    [suites, suiteId]
  );
  const isRunning = progress?.status === "queued" || progress?.status === "running";
  const parsedInstanceIds = useMemo(
    () => instanceIds.split(",").map((id) => id.trim()).filter(Boolean),
    [instanceIds]
  );

  useEffect(() => {
    void loadSuites();
    return () => eventSourceRef.current?.close();
  }, []);

  useEffect(() => {
    if (!selectedSuite) {
      return;
    }
    setDatasetName((current) => current || selectedSuite.defaultDatasetName);
    setSplit((current) => current || selectedSuite.defaultSplit);
  }, [selectedSuite]);

  async function loadSuites() {
    try {
      const payload = await fetchOfficialSuites();
      setSuites(payload.suites);
      setEvaluationEnabled(payload.officialSwebenchEvaluationEnabled);
      const firstSuite = payload.suites[0];
      if (firstSuite) {
        setSuiteId(firstSuite.id);
        setDatasetName(firstSuite.defaultDatasetName);
        setSplit(firstSuite.defaultSplit);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function handleSuiteChange(nextSuiteId: OfficialSuiteId) {
    const nextSuite = suites.find((suite) => suite.id === nextSuiteId);
    setSuiteId(nextSuiteId);
    setDatasetName(nextSuite?.defaultDatasetName ?? "");
    setSplit(nextSuite?.defaultSplit ?? "");
    setPredictionOutputPath("");
    setPredictionsPath("");
    setProgress(undefined);
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    setLocalFile(file ? { name: file.name, content: await file.text() } : undefined);
  }

  async function handleGeneratePredictions() {
    setStatus("");
    if (!modelId) {
      setStatus("Select a model before generating official predictions.");
      return;
    }
    if (sourceType === "inline_file" && !localFile) {
      setStatus("Choose a local JSON, JSONL, or CSV dataset file.");
      return;
    }

    try {
      const parsedMaxTokens = Number(maxTokens) || 8192;
      const response = await startOfficialPredictionRun(
        stripUndefined({
          suiteId,
          serverBaseUrl,
          modelId,
          source:
            sourceType === "huggingface"
              ? { type: "huggingface" as const, datasetName, split }
              : { type: "inline_file" as const, file: localFile as { name: string; content: string } },
          limit: Number(limit) || undefined,
          instanceIds: parsedInstanceIds.length > 0 ? parsedInstanceIds : undefined,
          outputPath: predictionOutputPath || undefined,
          temperature,
          maxTokens: parsedMaxTokens,
          timeoutMs
        })
      );
      subscribe(response.runId);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleRunEvaluation() {
    setStatus("");
    if (!predictionsPath) {
      setStatus("Enter a predictions path before running official evaluation.");
      return;
    }
    try {
      const response = await startOfficialEvaluationRun(
        stripUndefined({
          suiteId,
          predictionsPath,
          runId: evaluationRunId || undefined,
          datasetName: suiteId === "swe_bench" ? datasetName : undefined,
          split: suiteId === "swe_bench" ? split : undefined,
          maxWorkers: Number(maxWorkers) || undefined,
          instanceIds: parsedInstanceIds.length > 0 ? parsedInstanceIds : undefined,
          namespace: namespace || undefined,
          swebenchProRepoPath: suiteId === "swe_bench_pro" ? proRepoPath : undefined,
          rawSamplePath: suiteId === "swe_bench_pro" ? rawSamplePath : undefined,
          outputDir: evaluationOutputDir || undefined,
          scriptsDir: suiteId === "swe_bench_pro" ? scriptsDir : undefined,
          dockerhubUsername: suiteId === "swe_bench_pro" ? dockerhubUsername : undefined,
          useLocalDocker: suiteId === "swe_bench_pro" ? useLocalDocker : undefined
        })
      );
      subscribe(response.runId);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function subscribe(runId: string) {
    eventSourceRef.current?.close();
    const source = new EventSource(`/api/official-suites/runs/${runId}/events`);
    eventSourceRef.current = source;
    source.onmessage = (event) => {
      const nextProgress = JSON.parse(event.data) as OfficialRunProgress;
      setProgress(nextProgress);
      if (nextProgress.type === "prediction" && nextProgress.artifactPath) {
        setPredictionsPath(nextProgress.artifactPath);
      }
      if (nextProgress.status === "completed" || nextProgress.status === "failed") {
        source.close();
        eventSourceRef.current = null;
      }
    };
    source.onerror = () => {
      setStatus("Official run stream disconnected.");
      source.close();
      eventSourceRef.current = null;
    };
  }

  return (
    <section className="panel official-panel" aria-labelledby="official-swebench-heading">
      <div className="panel__header">
        <div>
          <h2 id="official-swebench-heading">Official SWE-bench</h2>
          <p>Full upstream prediction and evaluator path</p>
        </div>
        <FileCode2 size={18} aria-hidden="true" />
      </div>

      <div className="official-warning">
        <ShieldAlert size={15} aria-hidden="true" />
        <span>Evaluation runs upstream Docker tests and requires server opt-in.</span>
      </div>

      <label className="field">
        <span>Suite</span>
        <select value={suiteId} onChange={(event) => handleSuiteChange(event.target.value as OfficialSuiteId)}>
          {suites.map((suite) => (
            <option key={suite.id} value={suite.id}>
              {suite.name}
            </option>
          ))}
        </select>
      </label>

      {selectedSuite ? (
        <a className="official-link" href={selectedSuite.sourceUrl} target="_blank" rel="noreferrer">
          <ExternalLink size={14} aria-hidden="true" />
          Upstream repository
        </a>
      ) : null}

      <div className="panel__subhead">
        <Play size={14} aria-hidden="true" />
        <h3>Predictions</h3>
      </div>
      <label className="field">
        <span>Source</span>
        <select value={sourceType} onChange={(event) => setSourceType(event.target.value as SourceType)}>
          <option value="huggingface">Hugging Face dataset</option>
          <option value="inline_file">Local JSON/JSONL/CSV</option>
        </select>
      </label>
      {sourceType === "huggingface" ? (
        <div className="field-grid">
          <label className="field">
            <span>Dataset</span>
            <input value={datasetName} onChange={(event) => setDatasetName(event.target.value)} />
          </label>
          <label className="field">
            <span>Split</span>
            <input value={split} onChange={(event) => setSplit(event.target.value)} />
          </label>
        </div>
      ) : (
        <label className="field import-form__files">
          <span>Dataset file</span>
          <input type="file" accept=".json,.jsonl,.csv" onChange={(event) => void handleFileChange(event)} />
        </label>
      )}
      <div className="field-grid">
        <label className="field">
          <span>Limit</span>
          <input type="number" min="1" placeholder="Full" value={limit} onChange={(event) => setLimit(event.target.value)} />
        </label>
        <label className="field">
          <span>Output path</span>
          <input value={predictionOutputPath} onChange={(event) => setPredictionOutputPath(event.target.value)} placeholder="Auto" />
        </label>
      </div>
      <label className="field">
        <span>Instance IDs</span>
        <input value={instanceIds} onChange={(event) => setInstanceIds(event.target.value)} placeholder="Optional comma-separated IDs" />
      </label>
      <button className="secondary-button official-action" type="button" disabled={isRunning} onClick={() => void handleGeneratePredictions()}>
        <FileCode2 size={15} aria-hidden="true" />
        Generate predictions
      </button>

      <div className="panel__subhead">
        <ShieldAlert size={14} aria-hidden="true" />
        <h3>Official evaluation</h3>
        <StatusPill tone={evaluationEnabled ? "success" : "warning"}>{evaluationEnabled ? "Enabled" : "Disabled"}</StatusPill>
      </div>
      <label className="field">
        <span>Predictions path</span>
        <input value={predictionsPath} onChange={(event) => setPredictionsPath(event.target.value)} placeholder="official-runs/.../predictions.jsonl" />
      </label>
      <div className="field-grid">
        <label className="field">
          <span>Run ID</span>
          <input value={evaluationRunId} onChange={(event) => setEvaluationRunId(event.target.value)} placeholder="Auto" />
        </label>
        <label className="field">
          <span>Workers</span>
          <input type="number" min="1" value={maxWorkers} onChange={(event) => setMaxWorkers(event.target.value)} />
        </label>
      </div>
      {suiteId === "swe_bench" ? (
        <label className="field">
          <span>Docker namespace</span>
          <input value={namespace} onChange={(event) => setNamespace(event.target.value)} placeholder="Optional, use empty string on ARM if needed" />
        </label>
      ) : (
        <>
          <label className="field">
            <span>Pro repo path</span>
            <input value={proRepoPath} onChange={(event) => setProRepoPath(event.target.value)} placeholder="/path/to/SWE-bench_Pro-os" />
          </label>
          <label className="field">
            <span>Raw sample CSV</span>
            <input value={rawSamplePath} onChange={(event) => setRawSamplePath(event.target.value)} placeholder="/path/to/swe_bench_pro_full.csv" />
          </label>
          <label className="field">
            <span>Run scripts dir</span>
            <input value={scriptsDir} onChange={(event) => setScriptsDir(event.target.value)} placeholder="Defaults to repo/run_scripts" />
          </label>
          <div className="field-grid">
            <label className="field">
              <span>DockerHub user</span>
              <input value={dockerhubUsername} onChange={(event) => setDockerhubUsername(event.target.value)} />
            </label>
            <label className="code-toggle official-toggle">
              <input type="checkbox" checked={useLocalDocker} onChange={(event) => setUseLocalDocker(event.target.checked)} />
              Local Docker beta
            </label>
          </div>
        </>
      )}
      <label className="field">
        <span>Output dir</span>
        <input value={evaluationOutputDir} onChange={(event) => setEvaluationOutputDir(event.target.value)} placeholder="Auto" />
      </label>
      <button
        className="primary-button official-action"
        type="button"
        disabled={isRunning || !evaluationEnabled}
        onClick={() => void handleRunEvaluation()}
      >
        <Play size={15} aria-hidden="true" />
        Run official evaluation
      </button>

      {progress ? <OfficialProgress progress={progress} /> : null}
      {status ? <div className="import-status">{status}</div> : null}
    </section>
  );
}

function OfficialProgress({ progress }: { progress: OfficialRunProgress }) {
  const ratio = progress.totalItems > 0 ? Math.round((progress.completedItems / progress.totalItems) * 100) : 0;
  return (
    <div className="official-progress">
      <div className="official-progress__top">
        <StatusPill tone={progress.status === "failed" ? "error" : progress.status === "completed" ? "success" : "running"}>
          {progress.status}
        </StatusPill>
        <span>
          {progress.completedItems}/{progress.totalItems || "?"}
        </span>
      </div>
      <div className="progress-track" aria-label="Official run progress">
        <div className="progress-track__fill" style={{ width: `${ratio}%` }} />
      </div>
      {progress.currentInstanceId ? <p>Current: {progress.currentInstanceId}</p> : null}
      {progress.artifactPath ? <p>Artifact: {progress.artifactPath}</p> : null}
      {progress.message ? <pre>{progress.message}</pre> : null}
      {progress.lastError ? <p className="error-text">{progress.lastError}</p> : null}
    </div>
  );
}

function stripUndefined<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && !Number.isNaN(value))) as T;
}
