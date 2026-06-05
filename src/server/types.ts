export type AnswerType = "multiple_choice" | "numeric" | "string" | "code";
export type BenchmarkAnswerType = AnswerType | "mixed";

export interface BenchmarkSource {
  name: string;
  url?: string;
  license?: string;
  note?: string;
}

export interface BenchmarkChoice {
  label: string;
  text: string;
}

export interface BenchmarkItem {
  id: string;
  benchmark_id: string;
  benchmark_name: string;
  category: string;
  answer_type: AnswerType;
  prompt: string;
  choices?: BenchmarkChoice[];
  expected_answer: string;
  source?: BenchmarkSource;
  default_max_tokens?: number;
  code_language?: "python";
  code_tests?: string[];
}

export interface BenchmarkDefinition {
  id: string;
  name: string;
  category: string;
  description: string;
  answerType: BenchmarkAnswerType;
  defaultMaxTokens: number;
  itemCount: number;
  promptCount: number;
  enabled: boolean;
  isOfficial: boolean;
  requiresCodeExecution?: boolean;
  source?: BenchmarkSource;
}

export interface RunOptions {
  temperature: number;
  maxTokens?: number;
  timeoutMs: number;
  samples: number;
  seed?: number;
  enableCodeExecution?: boolean;
}

export interface RunRequest {
  serverBaseUrl: string;
  modelId: string;
  benchmarkIds: string[];
  options: RunOptions;
}

export interface LmStudioModel {
  id: string;
  object?: string;
  owned_by?: string;
}

export interface PromptResultRow {
  run_id: string;
  timestamp: string;
  server_base_url: string;
  model_id: string;
  benchmark_id: string;
  benchmark_name: string;
  benchmark_category: string;
  prompt_id: string;
  prompt: string;
  choices: string;
  expected_answer: string;
  raw_output: string;
  normalized_output: string;
  is_correct: string;
  score: string;
  latency_ms: string;
  error: string;
}

export interface ScoreResult {
  normalizedOutput: string;
  isCorrect: boolean;
  score: number;
}

export interface RunSummary {
  runId: string;
  timestamp: string;
  serverBaseUrl: string;
  modelId: string;
  benchmarkId: string;
  benchmarkName: string;
  benchmarkCategory: string;
  totalPrompts: number;
  correctPrompts: number;
  accuracy: number;
  averageLatencyMs: number;
  errors: number;
}

export interface RunProgress {
  runId: string;
  status: "queued" | "running" | "completed" | "failed";
  totalPrompts: number;
  completedPrompts: number;
  currentBenchmark?: string;
  currentPromptId?: string;
  correctPrompts: number;
  errors: number;
  averageLatencyMs: number;
  currentPromptPreview?: PromptPreview;
  lastResult?: PromptResultRow;
  message?: string;
}

export interface PromptPreview {
  promptId: string;
  benchmarkId: string;
  benchmarkName: string;
  answerType: AnswerType;
  prompt: string;
  choices: BenchmarkChoice[];
  expectedAnswer: string;
}

export type ImportFormat =
  | "rankedllm_jsonl"
  | "mmlu_csv"
  | "arc_jsonl"
  | "openbookqa_jsonl"
  | "hellaswag_jsonl"
  | "winogrande_jsonl"
  | "truthfulqa_csv"
  | "gsm8k_jsonl"
  | "boolq_jsonl"
  | "piqa_jsonl"
  | "bbh_json"
  | "mbpp_jsonl";

export interface ImportFilePayload {
  name: string;
  content: string;
}

export interface BenchmarkImportRequest {
  format: ImportFormat;
  benchmarkId: string;
  benchmarkName: string;
  category?: string;
  sourceName?: string;
  sourceUrl?: string;
  license?: string;
  limit?: number;
  files: ImportFilePayload[];
}

export type OfficialSuiteId = "swe_bench" | "swe_bench_pro";
export type OfficialRunStatus = "queued" | "running" | "completed" | "failed";

export interface OfficialSuiteDefinition {
  id: OfficialSuiteId;
  name: string;
  description: string;
  defaultDatasetName: string;
  defaultSplit: string;
  supportsPredictionGeneration: boolean;
  supportsOfficialEvaluation: boolean;
  evaluationRequiresEnv: string;
  sourceUrl: string;
}

export interface OfficialSuiteSource {
  type: "huggingface" | "inline_file";
  datasetName?: string;
  split?: string;
  file?: ImportFilePayload;
}

export interface OfficialPredictionRunRequest {
  suiteId: OfficialSuiteId;
  serverBaseUrl: string;
  modelId: string;
  source: OfficialSuiteSource;
  limit?: number;
  instanceIds?: string[];
  outputPath?: string;
  temperature: number;
  maxTokens?: number;
  timeoutMs: number;
}

export interface OfficialEvaluationRunRequest {
  suiteId: OfficialSuiteId;
  predictionsPath: string;
  runId?: string;
  datasetName?: string;
  split?: string;
  maxWorkers?: number;
  instanceIds?: string[];
  namespace?: string;
  reportDir?: string;
  swebenchProRepoPath?: string;
  rawSamplePath?: string;
  outputDir?: string;
  scriptsDir?: string;
  dockerhubUsername?: string;
  useLocalDocker?: boolean;
}

export interface OfficialRunProgress {
  runId: string;
  suiteId: OfficialSuiteId;
  type: "prediction" | "evaluation";
  status: OfficialRunStatus;
  totalItems: number;
  completedItems: number;
  errors: number;
  message?: string;
  artifactPath?: string;
  currentInstanceId?: string;
  lastError?: string;
  startedAt: string;
  completedAt?: string;
}
