export const DEFAULT_SERVER_BASE_URL = "http://192.168.111.36:1234/v1";
export const PREFERRED_TEST_MODEL_ID = "lfm2.5-8b-a1b";

export const SYSTEM_PROMPT =
  "You are being evaluated. Follow the requested output format exactly. Do not explain unless asked.";

export const REASONING_MODEL_DEFAULT_MAX_TOKENS = 4096;

export const RESULTS_CSV_HEADER = [
  "run_id",
  "timestamp",
  "server_base_url",
  "model_id",
  "benchmark_id",
  "benchmark_name",
  "benchmark_category",
  "prompt_id",
  "prompt",
  "choices",
  "expected_answer",
  "raw_output",
  "normalized_output",
  "is_correct",
  "score",
  "latency_ms",
  "error"
] as const;

export const RESULTS_CSV_HEADER_LINE = RESULTS_CSV_HEADER.join(",");

export const BENCHMARK_FILE_ORDER = [
  "smoke.jsonl",
  "mmlu_sample.jsonl",
  "arc_sample.jsonl",
  "hellaswag_sample.jsonl",
  "winogrande_sample.jsonl",
  "truthfulqa_sample.jsonl",
  "gsm8k_sample.jsonl",
  "boolq_sample.jsonl",
  "piqa_sample.jsonl",
  "openbookqa_sample.jsonl",
  "bbh_sample.jsonl",
  "mmlu_pro_hard_sample.jsonl",
  "gpqa_hard_sample.jsonl",
  "math_competition_sample.jsonl",
  "long_context_reasoning_sample.jsonl",
  "swebench_style_sample.jsonl",
  "mbpp_sample.jsonl"
];
