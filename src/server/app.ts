import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { aggregateRunSummaries } from "./aggregation.js";
import { getBenchmarkItems, loadBenchmarks, type LoadedBenchmarks } from "./benchmarkLoader.js";
import { DEFAULT_SERVER_BASE_URL, PREFERRED_TEST_MODEL_ID } from "./constants.js";
import { CodeBenchmarkExecutor } from "./codeExecutor.js";
import { CsvStore } from "./csvStore.js";
import { LmStudioClient, recommendModel } from "./lmStudioClient.js";
import { buildUserPrompt } from "./prompting.js";
import { RunManager } from "./runManager.js";
import { importBenchmarkFile } from "./officialImporters.js";
import { OfficialSwebenchManager } from "./swebenchIntegration.js";
import type {
  BenchmarkImportRequest,
  BenchmarkItem,
  OfficialEvaluationRunRequest,
  OfficialPredictionRunRequest,
  PromptPreview,
  RunOptions,
  RunRequest
} from "./types.js";

export interface CreateAppOptions {
  projectRoot?: string;
  fetchImpl?: typeof fetch;
}

export interface AppServices {
  csvStore: CsvStore;
  lmStudioClient: LmStudioClient;
  runManager: RunManager;
  officialSwebenchManager: OfficialSwebenchManager;
}

export interface CreatedApp {
  app: express.Express;
  services: AppServices;
}

export async function createApp(options: CreateAppOptions = {}): Promise<CreatedApp> {
  const projectRoot = options.projectRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const benchmarksDir = path.join(projectRoot, "benchmarks");
  const csvStore = new CsvStore(projectRoot);
  const csvStatus = await csvStore.initialize();
  let loadedBenchmarks = await loadBenchmarks(benchmarksDir);
  const lmStudioClient = new LmStudioClient(options.fetchImpl);
  const codeExecutor = new CodeBenchmarkExecutor();
  const officialSwebenchManager = new OfficialSwebenchManager(projectRoot, lmStudioClient);
  let runManager = createRunManager(csvStore, lmStudioClient, loadedBenchmarks, codeExecutor);

  const app = express();
  app.use(express.json({ limit: "25mb" }));

  app.get("/api/health", (_request, response) => {
    response.json({
      ok: true,
      defaultServerBaseUrl: DEFAULT_SERVER_BASE_URL,
      preferredTestModelId: PREFERRED_TEST_MODEL_ID,
      resultsCsvPath: csvStore.path,
      resultsCsvRows: csvStore.getRows().length,
      csvRepaired: csvStatus.repaired,
      csvBackupPath: csvStatus.backupPath,
      codeBenchmarksEnabled: codeExecutor.isEnabled(),
      officialSwebenchEvaluationEnabled: officialSwebenchManager.isEvaluationEnabled()
    });
  });

  app.post("/api/lmstudio/test-connection", async (request, response) => {
    const { baseUrl, timeoutMs } = request.body as { baseUrl?: string; timeoutMs?: number };
    try {
      const models = await lmStudioClient.listModels(baseUrl ?? DEFAULT_SERVER_BASE_URL, timeoutMs ?? 10000);
      response.json({
        ok: true,
        models,
        recommendedModelId: recommendModel(models),
        message: models.length > 0 ? `Connected. Found ${models.length} model(s).` : "Connected, but no models were returned. Load a model in LM Studio."
      });
    } catch (error) {
      response.status(502).json({
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.post("/api/lmstudio/models", async (request, response) => {
    const { baseUrl, timeoutMs } = request.body as { baseUrl?: string; timeoutMs?: number };
    try {
      const models = await lmStudioClient.listModels(baseUrl ?? DEFAULT_SERVER_BASE_URL, timeoutMs ?? 10000);
      response.json({
        models,
        recommendedModelId: recommendModel(models),
        message: models.length > 0 ? undefined : "No models returned. Load a model in LM Studio and refresh."
      });
    } catch (error) {
      response.status(502).json({
        models: [],
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.get("/api/benchmarks", (_request, response) => {
    response.json({ benchmarks: loadedBenchmarks.definitions });
  });

  app.get("/api/official-suites", (_request, response) => {
    response.json({
      suites: officialSwebenchManager.getSuites(),
      officialSwebenchEvaluationEnabled: officialSwebenchManager.isEvaluationEnabled()
    });
  });

  app.get("/api/benchmarks/items", (request, response) => {
    const ids = String(request.query.ids ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    const limit = Math.min(Math.max(Number(request.query.limit ?? 20), 1), 200);
    const selectedIds = ids.length > 0 ? ids : loadedBenchmarks.definitions.map((benchmark) => benchmark.id);
    const items = getBenchmarkItems(loadedBenchmarks.itemsByBenchmark, selectedIds).slice(0, limit);
    response.json({ items: items.map(toPromptPreview) });
  });

  app.post("/api/benchmarks/import", async (request, response) => {
    try {
      const result = await importBenchmarkFile(request.body as BenchmarkImportRequest, benchmarksDir);
      loadedBenchmarks = await loadBenchmarks(benchmarksDir);
      runManager = createRunManager(csvStore, lmStudioClient, loadedBenchmarks, codeExecutor);
      response.status(201).json({
        ...result,
        benchmarks: loadedBenchmarks.definitions
      });
    } catch (error) {
      response.status(400).json({ message: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/official-suites/prediction-runs", (request, response) => {
    const body = request.body as Partial<OfficialPredictionRunRequest>;
    const validationError = validateOfficialPredictionRunRequest(body);
    if (validationError) {
      response.status(400).json({ message: validationError });
      return;
    }

    const runId = officialSwebenchManager.startPredictionRun(body as OfficialPredictionRunRequest);
    response.status(202).json({ runId });
  });

  app.post("/api/official-suites/evaluation-runs", (request, response) => {
    const body = request.body as Partial<OfficialEvaluationRunRequest>;
    const validationError = validateOfficialEvaluationRunRequest(body);
    if (validationError) {
      response.status(400).json({ message: validationError });
      return;
    }
    if (!officialSwebenchManager.isEvaluationEnabled()) {
      response.status(400).json({
        message:
          "Official SWE-bench evaluation is disabled. Restart with RANKEDLLM_ENABLE_OFFICIAL_SWEBENCH=1 after Docker and the upstream Python harness are installed."
      });
      return;
    }

    try {
      const runId = officialSwebenchManager.startEvaluationRun(body as OfficialEvaluationRunRequest);
      response.status(202).json({ runId });
    } catch (error) {
      response.status(400).json({ message: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/official-suites/runs/:runId/events", (request, response) => {
    const runId = request.params.runId;
    const progress = officialSwebenchManager.getProgress(runId);
    if (!progress) {
      response.status(404).json({ message: "Official run not found" });
      return;
    }

    response.setHeader("Content-Type", "text/event-stream");
    response.setHeader("Cache-Control", "no-cache");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders?.();

    const send = (payload: unknown) => {
      response.write(`data: ${JSON.stringify(payload)}\n\n`);
    };
    const unsubscribe = officialSwebenchManager.subscribe(runId, send);
    request.on("close", unsubscribe);
  });

  app.post("/api/runs", (request, response) => {
    const body = request.body as Partial<RunRequest>;
    const validationError = validateRunRequest(body);
    if (validationError) {
      response.status(400).json({ message: validationError });
      return;
    }
    const selectedItems = getBenchmarkItems(loadedBenchmarks.itemsByBenchmark, body.benchmarkIds ?? []);
    const requiresCodeExecution = selectedItems.some((item) => item.answer_type === "code");
    if (requiresCodeExecution && !body.options?.enableCodeExecution) {
      response.status(400).json({ message: "Code benchmarks are disabled by default. Enable code execution for this run to continue." });
      return;
    }
    if (requiresCodeExecution && !codeExecutor.isEnabled()) {
      response.status(400).json({
        message: "Code benchmarks require server opt-in. Restart with RANKEDLLM_ENABLE_CODE_BENCHMARKS=1 and Docker available."
      });
      return;
    }

    const runId = runManager.startRun(body as RunRequest);
    response.status(202).json({ runId });
  });

  app.get("/api/runs/:runId/events", (request, response) => {
    const runId = request.params.runId;
    const progress = runManager.getProgress(runId);
    if (!progress) {
      response.status(404).json({ message: "Run not found" });
      return;
    }

    response.setHeader("Content-Type", "text/event-stream");
    response.setHeader("Cache-Control", "no-cache");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders?.();

    const send = (payload: unknown) => {
      response.write(`data: ${JSON.stringify(payload)}\n\n`);
    };
    const unsubscribe = runManager.subscribe(runId, send);
    request.on("close", unsubscribe);
  });

  app.get("/api/runs", (_request, response) => {
    const rows = csvStore.getRows();
    response.json({
      summaries: aggregateRunSummaries(rows),
      rows
    });
  });

  app.get("/api/results.csv", (_request, response) => {
    response.download(csvStore.path, "results.csv");
  });

  return { app, services: { csvStore, lmStudioClient, runManager, officialSwebenchManager } };
}

function createRunManager(
  csvStore: CsvStore,
  lmStudioClient: LmStudioClient,
  loadedBenchmarks: LoadedBenchmarks,
  codeExecutor: CodeBenchmarkExecutor
): RunManager {
  return new RunManager(
    csvStore,
    lmStudioClient,
    loadedBenchmarks.itemsByBenchmark,
    loadedBenchmarks.definitions,
    codeExecutor
  );
}

function toPromptPreview(item: BenchmarkItem): PromptPreview {
  return {
    promptId: item.id,
    benchmarkId: item.benchmark_id,
    benchmarkName: item.benchmark_name,
    answerType: item.answer_type,
    prompt: buildUserPrompt(item),
    choices: item.choices ?? [],
    expectedAnswer: item.expected_answer
  };
}

function validateRunRequest(request: Partial<RunRequest>): string | undefined {
  if (!request.serverBaseUrl) {
    return "serverBaseUrl is required";
  }
  if (!request.modelId) {
    return "modelId is required";
  }
  if (!request.benchmarkIds?.length) {
    return "Select at least one benchmark";
  }
  if (!request.options) {
    return "options are required";
  }

  const options = request.options as Partial<RunOptions>;
  if (typeof options.temperature !== "number" || options.temperature < 0) {
    return "temperature must be a non-negative number";
  }
  if (options.maxTokens !== undefined && (!Number.isInteger(options.maxTokens) || options.maxTokens < 1)) {
    return "maxTokens must be a positive integer when provided";
  }
  if (typeof options.timeoutMs !== "number" || !Number.isInteger(options.timeoutMs) || options.timeoutMs < 1000) {
    return "timeoutMs must be at least 1000";
  }
  if (typeof options.samples !== "number" || !Number.isInteger(options.samples) || options.samples < 1) {
    return "samples must be at least 1";
  }
  if (options.seed !== undefined && !Number.isInteger(options.seed)) {
    return "seed must be an integer when provided";
  }
  if (options.enableCodeExecution !== undefined && typeof options.enableCodeExecution !== "boolean") {
    return "enableCodeExecution must be a boolean when provided";
  }
  return undefined;
}

function validateOfficialPredictionRunRequest(request: Partial<OfficialPredictionRunRequest>): string | undefined {
  if (request.suiteId !== "swe_bench" && request.suiteId !== "swe_bench_pro") {
    return "suiteId must be swe_bench or swe_bench_pro";
  }
  if (!request.serverBaseUrl) {
    return "serverBaseUrl is required";
  }
  if (!request.modelId) {
    return "modelId is required";
  }
  if (!request.source) {
    return "source is required";
  }
  if (request.source.type !== "huggingface" && request.source.type !== "inline_file") {
    return "source.type must be huggingface or inline_file";
  }
  if (request.source.type === "inline_file" && !request.source.file) {
    return "source.file is required for inline_file prediction generation";
  }
  if (typeof request.temperature !== "number" || request.temperature < 0) {
    return "temperature must be a non-negative number";
  }
  if (typeof request.timeoutMs !== "number" || !Number.isInteger(request.timeoutMs) || request.timeoutMs < 1000) {
    return "timeoutMs must be at least 1000";
  }
  if (request.maxTokens !== undefined && (!Number.isInteger(request.maxTokens) || request.maxTokens < 1)) {
    return "maxTokens must be a positive integer when provided";
  }
  if (request.limit !== undefined && (!Number.isInteger(request.limit) || request.limit < 1)) {
    return "limit must be a positive integer when provided";
  }
  return undefined;
}

function validateOfficialEvaluationRunRequest(request: Partial<OfficialEvaluationRunRequest>): string | undefined {
  if (request.suiteId !== "swe_bench" && request.suiteId !== "swe_bench_pro") {
    return "suiteId must be swe_bench or swe_bench_pro";
  }
  if (!request.predictionsPath) {
    return "predictionsPath is required";
  }
  if (request.maxWorkers !== undefined && (!Number.isInteger(request.maxWorkers) || request.maxWorkers < 1)) {
    return "maxWorkers must be a positive integer when provided";
  }
  if (request.suiteId === "swe_bench_pro") {
    if (!request.swebenchProRepoPath) {
      return "swebenchProRepoPath is required for SWE-bench Pro";
    }
    if (!request.rawSamplePath) {
      return "rawSamplePath is required for SWE-bench Pro";
    }
  }
  return undefined;
}
