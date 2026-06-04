export interface BenchmarkSource {
  name: string;
  url?: string;
  license?: string;
  note?: string;
}

export type AnswerType = "multiple_choice" | "numeric" | "string" | "code";
export type BenchmarkAnswerType = AnswerType | "mixed";

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

export interface LmStudioModel {
  id: string;
  object?: string;
  owned_by?: string;
}

export interface RunOptions {
  temperature: number;
  maxTokens?: number;
  timeoutMs: number;
  samples: number;
  seed?: number;
  enableCodeExecution?: boolean;
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

export interface BenchmarkChoice {
  label: string;
  text: string;
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
