import type {
  BenchmarkDefinition,
  ImportFormat,
  LmStudioModel,
  OfficialSuiteDefinition,
  OfficialSuiteId,
  PromptPreview,
  PromptResultRow,
  RunOptions,
  RunSummary
} from "./types";

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    ...init
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(payload.message ?? response.statusText);
  }

  return response.json() as Promise<T>;
}

export async function fetchBenchmarks(): Promise<BenchmarkDefinition[]> {
  const payload = await requestJson<{ benchmarks: BenchmarkDefinition[] }>("/api/benchmarks");
  return payload.benchmarks;
}

export async function fetchBenchmarkPreviews(benchmarkIds: string[], limit = 20): Promise<PromptPreview[]> {
  const params = new URLSearchParams({ ids: benchmarkIds.join(","), limit: String(limit) });
  const payload = await requestJson<{ items: PromptPreview[] }>(`/api/benchmarks/items?${params.toString()}`);
  return payload.items;
}

export async function importBenchmark(payload: {
  format: ImportFormat;
  benchmarkId: string;
  benchmarkName: string;
  category?: string;
  sourceName?: string;
  sourceUrl?: string;
  license?: string;
  limit?: number;
  files: Array<{ name: string; content: string }>;
}): Promise<{ importedCount: number; benchmarkId: string; benchmarks: BenchmarkDefinition[] }> {
  return requestJson("/api/benchmarks/import", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function fetchHistory(): Promise<{ summaries: RunSummary[]; rows: PromptResultRow[] }> {
  return requestJson<{ summaries: RunSummary[]; rows: PromptResultRow[] }>("/api/runs");
}

export async function fetchOfficialSuites(): Promise<{
  suites: OfficialSuiteDefinition[];
  officialSwebenchEvaluationEnabled: boolean;
}> {
  return requestJson("/api/official-suites");
}

export async function startOfficialPredictionRun(payload: {
  suiteId: OfficialSuiteId;
  serverBaseUrl: string;
  modelId: string;
  source:
    | { type: "huggingface"; datasetName?: string; split?: string }
    | { type: "inline_file"; file: { name: string; content: string } };
  limit?: number;
  instanceIds?: string[];
  outputPath?: string;
  temperature: number;
  maxTokens?: number;
  timeoutMs: number;
}): Promise<{ runId: string }> {
  return requestJson("/api/official-suites/prediction-runs", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function startOfficialEvaluationRun(payload: {
  suiteId: OfficialSuiteId;
  predictionsPath: string;
  runId?: string;
  datasetName?: string;
  split?: string;
  maxWorkers?: number;
  instanceIds?: string[];
  namespace?: string;
  swebenchProRepoPath?: string;
  rawSamplePath?: string;
  outputDir?: string;
  scriptsDir?: string;
  dockerhubUsername?: string;
  useLocalDocker?: boolean;
}): Promise<{ runId: string }> {
  return requestJson("/api/official-suites/evaluation-runs", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function testConnection(baseUrl: string, timeoutMs: number): Promise<{
  ok: boolean;
  models: LmStudioModel[];
  recommendedModelId?: string;
  message: string;
}> {
  return requestJson("/api/lmstudio/test-connection", {
    method: "POST",
    body: JSON.stringify({ baseUrl, timeoutMs })
  });
}

export async function fetchModels(baseUrl: string, timeoutMs: number): Promise<{
  models: LmStudioModel[];
  recommendedModelId?: string;
  message?: string;
}> {
  return requestJson("/api/lmstudio/models", {
    method: "POST",
    body: JSON.stringify({ baseUrl, timeoutMs })
  });
}

export async function startRun(payload: {
  serverBaseUrl: string;
  modelId: string;
  benchmarkIds: string[];
  options: RunOptions;
}): Promise<{ runId: string }> {
  return requestJson("/api/runs", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
