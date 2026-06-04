import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { BENCHMARK_FILE_ORDER } from "./constants.js";
import type { BenchmarkDefinition, BenchmarkItem } from "./types.js";

const DESCRIPTIONS: Record<string, string> = {
  smoke: "Fast local sanity checks for arithmetic, formatting, facts, and short reasoning.",
  mmlu_sample: "Local multiple-choice knowledge subset inspired by MMLU categories.",
  arc_sample: "Local science reasoning subset inspired by AI2 ARC.",
  hellaswag_sample: "Local commonsense continuation subset inspired by HellaSwag.",
  winogrande_sample: "Local pronoun and commonsense coreference subset inspired by WinoGrande.",
  truthfulqa_sample: "Local truthfulness and hallucination-resistance subset inspired by TruthfulQA.",
  gsm8k_sample: "Local grade-school math subset inspired by GSM8K.",
  boolq_sample: "Local yes/no reading-comprehension subset inspired by BoolQ.",
  piqa_sample: "Local physical commonsense subset inspired by PIQA.",
  openbookqa_sample: "Local elementary science subset inspired by OpenBookQA.",
  bbh_sample: "Local hard-reasoning subset inspired by BIG-Bench Hard.",
  mmlu_pro_hard_sample: "Larger difficult academic knowledge subset inspired by MMLU-Pro.",
  gpqa_hard_sample: "Difficult science reasoning subset inspired by GPQA-style expert questions.",
  math_competition_sample: "Competition-style deterministic math subset with exact numeric answers.",
  long_context_reasoning_sample: "Longer-context deterministic reasoning subset for retrieval, synthesis, and constraint following.",
  swebench_style_sample: "Disabled-by-default Python bug-fix tasks inspired by SWE-bench-style software repair.",
  mbpp_sample: "Disabled-by-default local Python code-generation subset inspired by MBPP."
};

const DEFAULT_MAX_TOKENS: Record<string, number> = {
  smoke: 32,
  mmlu_sample: 8,
  arc_sample: 8,
  hellaswag_sample: 8,
  winogrande_sample: 8,
  truthfulqa_sample: 8,
  gsm8k_sample: 64,
  boolq_sample: 8,
  piqa_sample: 8,
  openbookqa_sample: 8,
  bbh_sample: 16,
  mmlu_pro_hard_sample: 8,
  gpqa_hard_sample: 8,
  math_competition_sample: 96,
  long_context_reasoning_sample: 96,
  swebench_style_sample: 512,
  mbpp_sample: 256
};

export interface LoadedBenchmarks {
  definitions: BenchmarkDefinition[];
  itemsByBenchmark: Map<string, BenchmarkItem[]>;
}

export async function loadBenchmarks(benchmarksDir: string): Promise<LoadedBenchmarks> {
  const availableFiles = new Set(await listJsonlFiles(benchmarksDir));
  const orderedFiles = [
    ...BENCHMARK_FILE_ORDER.filter((file) => availableFiles.has(file)),
    ...[...availableFiles].filter((file) => file.endsWith(".jsonl") && !BENCHMARK_FILE_ORDER.includes(file)).sort()
  ];

  const itemsByBenchmark = new Map<string, BenchmarkItem[]>();

  for (const file of orderedFiles) {
    const filePath = path.join(benchmarksDir, file);
    const content = await readFile(filePath, "utf8");
    const lines = content.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith("#"));

    for (const [lineIndex, line] of lines.entries()) {
      const parsed = JSON.parse(line) as BenchmarkItem;
      validateBenchmarkItem(parsed, `${file}:${lineIndex + 1}`);
      const existing = itemsByBenchmark.get(parsed.benchmark_id) ?? [];
      existing.push(parsed);
      itemsByBenchmark.set(parsed.benchmark_id, existing);
    }
  }

  const definitions: BenchmarkDefinition[] = [...itemsByBenchmark.entries()].map(([id, items]) => {
    const first = items[0];
    const answerTypes = new Set(items.map((item) => item.answer_type));
    return {
      id,
      name: first.benchmark_name,
      category: first.category,
      description: DESCRIPTIONS[id] ?? "Local benchmark subset loaded from JSONL.",
      answerType: answerTypes.size > 1 ? "mixed" : first.answer_type,
      defaultMaxTokens: DEFAULT_MAX_TOKENS[id] ?? first.default_max_tokens ?? 32,
      itemCount: items.length,
      promptCount: items.length,
      enabled: true,
      isOfficial: false,
      requiresCodeExecution: first.answer_type === "code",
      source: first.source
    };
  });

  return { definitions, itemsByBenchmark };
}

export function getBenchmarkItems(
  itemsByBenchmark: Map<string, BenchmarkItem[]>,
  benchmarkIds: string[]
): BenchmarkItem[] {
  return benchmarkIds.flatMap((benchmarkId) => itemsByBenchmark.get(benchmarkId) ?? []);
}

function validateBenchmarkItem(item: BenchmarkItem, location: string): void {
  const requiredFields: Array<keyof BenchmarkItem> = [
    "id",
    "benchmark_id",
    "benchmark_name",
    "category",
    "answer_type",
    "prompt",
    "expected_answer"
  ];

  for (const field of requiredFields) {
    if (!item[field]) {
      throw new Error(`Missing ${field} in benchmark item at ${location}`);
    }
  }

  if (!["multiple_choice", "numeric", "string", "code"].includes(item.answer_type)) {
    throw new Error(`Invalid answer_type in benchmark item at ${location}`);
  }

  if (item.answer_type === "multiple_choice" && (!item.choices || item.choices.length < 2)) {
    throw new Error(`Multiple-choice item requires choices at ${location}`);
  }

  if (item.answer_type === "code" && item.code_language !== "python") {
    throw new Error(`Code item requires code_language="python" at ${location}`);
  }
}

async function listJsonlFiles(rootDir: string, relativeDir = ""): Promise<string[]> {
  const absoluteDir = path.join(rootDir, relativeDir);
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listJsonlFiles(rootDir, relativePath)));
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(relativePath);
    }
  }
  return files;
}
