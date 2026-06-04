import { BarChart3, Database, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchBenchmarkPreviews, fetchBenchmarks, fetchHistory, fetchModels, startRun, testConnection } from "./api";
import { BenchmarkPreviewPanel } from "./components/BenchmarkPreviewPanel";
import { BenchmarkSelector } from "./components/BenchmarkSelector";
import { ConfigurationPanel } from "./components/ConfigurationPanel";
import { HistoryPage } from "./components/HistoryPage";
import { ImportPanel } from "./components/ImportPanel";
import { LiveRunPanel } from "./components/LiveRunPanel";
import { StatusPill } from "./components/StatusPill";
import type { BenchmarkDefinition, LmStudioModel, PromptPreview, PromptResultRow, RunProgress, RunSummary } from "./types";

const DEFAULT_SERVER_BASE_URL = "http://192.168.111.36:1234/v1";

type View = "dashboard" | "history";
type StatusTone = "idle" | "success" | "warning" | "error" | "running";

export default function App() {
  const [view, setView] = useState<View>("dashboard");
  const [benchmarks, setBenchmarks] = useState<BenchmarkDefinition[]>([]);
  const [selectedBenchmarkIds, setSelectedBenchmarkIds] = useState<string[]>(["smoke"]);
  const [models, setModels] = useState<LmStudioModel[]>([]);
  const [modelId, setModelId] = useState("");
  const [serverBaseUrl, setServerBaseUrl] = useState(DEFAULT_SERVER_BASE_URL);
  const [temperature, setTemperature] = useState(0);
  const [maxTokens, setMaxTokens] = useState("");
  const [timeoutMs, setTimeoutMs] = useState(60000);
  const [samples, setSamples] = useState(1);
  const [seed, setSeed] = useState("");
  const [enableCodeExecution, setEnableCodeExecution] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState("");
  const [connectionTone, setConnectionTone] = useState<StatusTone>("idle");
  const [history, setHistory] = useState<RunSummary[]>([]);
  const [previews, setPreviews] = useState<PromptPreview[]>([]);
  const [recentResults, setRecentResults] = useState<PromptResultRow[]>([]);
  const [activeProgress, setActiveProgress] = useState<RunProgress>();
  const [isBusy, setIsBusy] = useState(false);
  const [appError, setAppError] = useState("");
  const eventSourceRef = useRef<EventSource | null>(null);

  const isRunning = activeProgress?.status === "queued" || activeProgress?.status === "running";

  useEffect(() => {
    void loadInitialData();
  }, []);

  useEffect(() => {
    void loadPreviews();
  }, [selectedBenchmarkIds.join(",")]);

  async function loadInitialData() {
    try {
      const [benchmarkPayload, historyPayload] = await Promise.all([fetchBenchmarks(), fetchHistory()]);
      setBenchmarks(benchmarkPayload);
      setHistory(historyPayload.summaries);
      if (!benchmarkPayload.some((benchmark) => benchmark.id === "smoke")) {
        setSelectedBenchmarkIds(benchmarkPayload.filter((benchmark) => benchmark.enabled).slice(0, 1).map((benchmark) => benchmark.id));
      }
    } catch (error) {
      setAppError(error instanceof Error ? error.message : String(error));
    }
  }

  async function refreshHistory() {
    const payload = await fetchHistory();
    setHistory(payload.summaries);
  }

  async function loadPreviews() {
    if (selectedBenchmarkIds.length === 0) {
      setPreviews([]);
      return;
    }
    try {
      setPreviews(await fetchBenchmarkPreviews(selectedBenchmarkIds, 12));
    } catch (error) {
      setAppError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleTestConnection() {
    setIsBusy(true);
    setConnectionTone("running");
    setConnectionMessage("Testing connection");
    try {
      const payload = await testConnection(serverBaseUrl, timeoutMs);
      setModels(payload.models);
      setConnectionTone(payload.models.length > 0 ? "success" : "warning");
      setConnectionMessage(payload.message);
      if (payload.recommendedModelId) {
        setModelId(payload.recommendedModelId);
      }
    } catch (error) {
      setConnectionTone("error");
      setConnectionMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleRefreshModels() {
    setIsBusy(true);
    setConnectionTone("running");
    setConnectionMessage("Refreshing models");
    try {
      const payload = await fetchModels(serverBaseUrl, timeoutMs);
      setModels(payload.models);
      setConnectionTone(payload.models.length > 0 ? "success" : "warning");
      setConnectionMessage(payload.message ?? `Found ${payload.models.length} model(s)`);
      if (payload.recommendedModelId) {
        setModelId((current) => current || payload.recommendedModelId || "");
      }
    } catch (error) {
      setConnectionTone("error");
      setConnectionMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsBusy(false);
    }
  }

  function toggleBenchmark(benchmarkId: string) {
    setSelectedBenchmarkIds((current) =>
      current.includes(benchmarkId)
        ? current.filter((id) => id !== benchmarkId)
        : [...current, benchmarkId]
    );
  }

  function handleCodeExecutionChange(enabled: boolean) {
    setEnableCodeExecution(enabled);
    if (!enabled) {
      setSelectedBenchmarkIds((current) =>
        current.filter((id) => !benchmarks.find((benchmark) => benchmark.id === id)?.requiresCodeExecution)
      );
    }
  }

  async function handleRun() {
    setAppError("");
    if (!modelId) {
      setAppError("Select a model before running benchmarks.");
      return;
    }
    const runnableBenchmarkIds = selectedBenchmarkIds.filter((id) => {
      const benchmark = benchmarks.find((entry) => entry.id === id);
      return !benchmark?.requiresCodeExecution || enableCodeExecution;
    });
    if (runnableBenchmarkIds.length === 0) {
      setAppError("Select at least one benchmark.");
      return;
    }

    const parsedMaxTokens = maxTokens ? Number(maxTokens) : undefined;
    const parsedSeed = seed ? Number(seed) : undefined;
    const runOptions = {
      temperature,
      maxTokens: parsedMaxTokens,
      timeoutMs,
      samples,
      seed: parsedSeed,
      enableCodeExecution
    };

    setRecentResults([]);
    setActiveProgress(undefined);

    try {
      const { runId } = await startRun({
        serverBaseUrl,
        modelId,
        benchmarkIds: runnableBenchmarkIds,
        options: stripUndefined(runOptions)
      });
      subscribeToRun(runId);
    } catch (error) {
      setAppError(error instanceof Error ? error.message : String(error));
    }
  }

  function handleBenchmarkImported(nextBenchmarks: BenchmarkDefinition[]) {
    setBenchmarks(nextBenchmarks);
    void loadPreviews();
  }

  function subscribeToRun(runId: string) {
    eventSourceRef.current?.close();
    const source = new EventSource(`/api/runs/${runId}/events`);
    eventSourceRef.current = source;

    source.onmessage = (event) => {
      const progress = JSON.parse(event.data) as RunProgress;
      setActiveProgress(progress);
      if (progress.lastResult) {
        setRecentResults((current) => addRecentResult(current, progress.lastResult as PromptResultRow));
      }
      if (progress.status === "completed" || progress.status === "failed") {
        source.close();
        eventSourceRef.current = null;
        void refreshHistory();
      }
    };

    source.onerror = () => {
      setAppError("Live run stream disconnected.");
      source.close();
      eventSourceRef.current = null;
    };
  }

  const totalPromptEstimate = useMemo(() => {
    return benchmarks
      .filter((benchmark) => selectedBenchmarkIds.includes(benchmark.id))
      .filter((benchmark) => !benchmark.requiresCodeExecution || enableCodeExecution)
      .reduce((sum, benchmark) => sum + benchmark.promptCount * samples, 0);
  }, [benchmarks, enableCodeExecution, samples, selectedBenchmarkIds]);

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            <RankedLlmMark />
          </span>
          <div>
            <h1>RankedLLM</h1>
            <p>Local LM Studio benchmark runner</p>
          </div>
        </div>

        <nav className="view-tabs" aria-label="Primary">
          <button
            type="button"
            className={view === "dashboard" ? "view-tabs__button view-tabs__button--active" : "view-tabs__button"}
            onClick={() => setView("dashboard")}
          >
            <BarChart3 size={15} aria-hidden="true" />
            Dashboard
          </button>
          <button
            type="button"
            className={view === "history" ? "view-tabs__button view-tabs__button--active" : "view-tabs__button"}
            onClick={() => setView("history")}
          >
            <Database size={15} aria-hidden="true" />
            History
          </button>
        </nav>

        <div className="top-bar__right">
          <StatusPill tone={isRunning ? "running" : "idle"}>{isRunning ? "Running" : `${totalPromptEstimate} prompts`}</StatusPill>
          <button type="button" className="icon-button" onClick={() => void refreshHistory()} aria-label="Refresh history">
            <RefreshCw size={16} aria-hidden="true" />
          </button>
        </div>
      </header>

      {appError ? <div className="app-alert">{appError}</div> : null}

      {view === "dashboard" ? (
        <div className="dashboard-layout">
          <div className="sidebar-stack">
            <ConfigurationPanel
              serverBaseUrl={serverBaseUrl}
              setServerBaseUrl={setServerBaseUrl}
              models={models}
              modelId={modelId}
              setModelId={setModelId}
              temperature={temperature}
              setTemperature={setTemperature}
              maxTokens={maxTokens}
              setMaxTokens={setMaxTokens}
              timeoutMs={timeoutMs}
              setTimeoutMs={setTimeoutMs}
              samples={samples}
              setSamples={setSamples}
              seed={seed}
              setSeed={setSeed}
              connectionMessage={connectionMessage}
              connectionTone={connectionTone}
              isBusy={isBusy}
              onTestConnection={handleTestConnection}
              onRefreshModels={handleRefreshModels}
            />
            <ImportPanel onImported={handleBenchmarkImported} />
          </div>

          <div className="dashboard-main">
            <BenchmarkSelector
              benchmarks={benchmarks}
              selectedIds={selectedBenchmarkIds}
              samples={samples}
              isRunning={isRunning}
              enableCodeExecution={enableCodeExecution}
              onToggle={toggleBenchmark}
              onCodeExecutionChange={handleCodeExecutionChange}
              onRun={handleRun}
            />
            <BenchmarkPreviewPanel previews={previews} />
            <LiveRunPanel progress={activeProgress} recentResults={recentResults} />
          </div>
        </div>
      ) : (
        <HistoryPage summaries={history} />
      )}
    </main>
  );
}

function RankedLlmMark() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="24" height="24" focusable="false">
      <path d="M18 39a14 14 0 0 1 28 0" fill="none" stroke="#0f8b8d" strokeWidth="5" strokeLinecap="round" />
      <path d="M32 39l9-13" fill="none" stroke="#0a6b70" strokeWidth="4" strokeLinecap="round" />
      <circle cx="32" cy="39" r="4" fill="#0a6b70" />
      <rect x="18" y="44" width="28" height="5" rx="2.5" fill="#1d232b" />
      <rect x="20" y="19" width="5" height="10" rx="2.5" fill="#b7c3c8" />
      <rect x="30" y="15" width="5" height="9" rx="2.5" fill="#0f8b8d" />
      <rect x="40" y="20" width="5" height="8" rx="2.5" fill="#b7c3c8" />
    </svg>
  );
}

function stripUndefined<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && !Number.isNaN(value))) as T;
}

function addRecentResult(current: PromptResultRow[], next: PromptResultRow): PromptResultRow[] {
  const key = `${next.run_id}:${next.prompt_id}`;
  const withoutDuplicate = current.filter((row) => `${row.run_id}:${row.prompt_id}` !== key);
  return [next, ...withoutDuplicate].slice(0, 12);
}
