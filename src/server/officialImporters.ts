import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseCsv } from "./csvStore.js";
import type {
  BenchmarkChoice,
  BenchmarkImportRequest,
  BenchmarkItem,
  BenchmarkSource,
  ImportFilePayload,
  ImportFormat
} from "./types.js";

export interface ImportResult {
  filePath: string;
  importedCount: number;
  benchmarkId: string;
}

export async function importBenchmarkFile(
  request: BenchmarkImportRequest,
  benchmarksDir: string
): Promise<ImportResult> {
  validateImportRequest(request);
  const benchmarkId = sanitizeBenchmarkId(request.benchmarkId);
  const items = convertImportToItems({ ...request, benchmarkId });
  const limitedItems = typeof request.limit === "number" && request.limit > 0 ? items.slice(0, request.limit) : items;
  if (limitedItems.length === 0) {
    throw new Error("No importable benchmark items were found");
  }

  const importedDir = path.join(benchmarksDir, "imported");
  await mkdir(importedDir, { recursive: true });
  const filePath = path.join(importedDir, `${benchmarkId}.jsonl`);
  await writeFile(filePath, `${limitedItems.map((item) => JSON.stringify(item)).join("\n")}\n`, "utf8");
  return { filePath, importedCount: limitedItems.length, benchmarkId };
}

export function convertImportToItems(request: BenchmarkImportRequest): BenchmarkItem[] {
  const source: BenchmarkSource = {
    name: request.sourceName || importFormatLabel(request.format),
    url: request.sourceUrl || undefined,
    license: request.license || undefined,
    note: "Imported through RankedLLM official-format adapter. Use the upstream benchmark protocol for official scores."
  };

  switch (request.format) {
    case "rankedllm_jsonl":
      return jsonlObjects(request.files[0]).map((object, index) => normalizeRankedItem(object, request, source, index));
    case "mmlu_csv":
      return importMmluCsv(request, source);
    case "arc_jsonl":
    case "openbookqa_jsonl":
      return jsonlObjects(request.files[0]).map((object, index) => importChoiceObject(object, request, source, index));
    case "hellaswag_jsonl":
      return jsonlObjects(request.files[0]).map((object, index) => importHellaSwagObject(object, request, source, index));
    case "winogrande_jsonl":
      return jsonlObjects(request.files[0]).map((object, index) => importWinoGrandeObject(object, request, source, index));
    case "truthfulqa_csv":
      return importTruthfulQaCsv(request, source);
    case "gsm8k_jsonl":
      return jsonlObjects(request.files[0]).map((object, index) => importGsm8kObject(object, request, source, index));
    case "boolq_jsonl":
      return jsonlObjects(request.files[0]).map((object, index) => importBoolQObject(object, request, source, index));
    case "piqa_jsonl":
      return importPiqaFiles(request, source);
    case "bbh_json":
      return importBbhJson(request, source);
    case "mbpp_jsonl":
      return jsonlObjects(request.files[0]).map((object, index) => importMbppObject(object, request, source, index));
  }
}

function validateImportRequest(request: BenchmarkImportRequest): void {
  if (!request.format || !isKnownFormat(request.format)) {
    throw new Error("A supported import format is required");
  }
  if (!request.benchmarkId || !request.benchmarkName) {
    throw new Error("benchmarkId and benchmarkName are required");
  }
  if (!request.files?.length) {
    throw new Error("At least one file is required");
  }
}

function isKnownFormat(format: string): format is ImportFormat {
  return [
    "rankedllm_jsonl",
    "mmlu_csv",
    "arc_jsonl",
    "openbookqa_jsonl",
    "hellaswag_jsonl",
    "winogrande_jsonl",
    "truthfulqa_csv",
    "gsm8k_jsonl",
    "boolq_jsonl",
    "piqa_jsonl",
    "bbh_json",
    "mbpp_jsonl"
  ].includes(format);
}

function normalizeRankedItem(
  object: Record<string, unknown>,
  request: BenchmarkImportRequest,
  source: BenchmarkSource,
  index: number
): BenchmarkItem {
  return {
    id: stringValue(object.id, `${request.benchmarkId}_${index + 1}`),
    benchmark_id: request.benchmarkId,
    benchmark_name: request.benchmarkName,
    category: stringValue(object.category, request.category || "imported"),
    answer_type: answerTypeValue(object.answer_type),
    prompt: requiredString(object.prompt, "prompt"),
    choices: choicesValue(object.choices),
    expected_answer: requiredString(object.expected_answer, "expected_answer"),
    source: sourceValue(object.source) ?? source,
    default_max_tokens: numberValue(object.default_max_tokens),
    code_language: object.code_language === "python" ? "python" : undefined,
    code_tests: stringArrayValue(object.code_tests)
  };
}

function importMmluCsv(request: BenchmarkImportRequest, source: BenchmarkSource): BenchmarkItem[] {
  const records = parseCsv(request.files[0].content).filter((record) => record.length >= 6);
  const hasHeader = records[0]?.some((cell) => cell.toLowerCase().includes("question"));
  return records.slice(hasHeader ? 1 : 0).map((record, index) => ({
    id: `${request.benchmarkId}_${index + 1}`,
    benchmark_id: request.benchmarkId,
    benchmark_name: request.benchmarkName,
    category: request.category || "knowledge",
    answer_type: "multiple_choice",
    prompt: record[0],
    choices: ["A", "B", "C", "D"].map((label, offset) => ({ label, text: record[offset + 1] })),
    expected_answer: record[5].trim().toUpperCase(),
    source,
    default_max_tokens: 8
  }));
}

function importChoiceObject(
  object: Record<string, unknown>,
  request: BenchmarkImportRequest,
  source: BenchmarkSource,
  index: number
): BenchmarkItem {
  const choices = officialChoices(object.choices);
  return {
    id: stringValue(object.id, `${request.benchmarkId}_${index + 1}`),
    benchmark_id: request.benchmarkId,
    benchmark_name: request.benchmarkName,
    category: request.category || "multiple_choice",
    answer_type: "multiple_choice",
    prompt: requiredString(object.question ?? object.question_stem, "question"),
    choices,
    expected_answer: requiredString(object.answerKey ?? object.answer_key ?? object.answer, "answerKey").toUpperCase(),
    source,
    default_max_tokens: 8
  };
}

function importHellaSwagObject(
  object: Record<string, unknown>,
  request: BenchmarkImportRequest,
  source: BenchmarkSource,
  index: number
): BenchmarkItem {
  const endings = stringArrayValue(object.endings) ?? [];
  return {
    id: stringValue(object.ind ?? object.id, `${request.benchmarkId}_${index + 1}`),
    benchmark_id: request.benchmarkId,
    benchmark_name: request.benchmarkName,
    category: request.category || "commonsense",
    answer_type: "multiple_choice",
    prompt: requiredString(object.ctx ?? object.context, "ctx"),
    choices: endings.map((ending, choiceIndex) => ({ label: labelForIndex(choiceIndex), text: ending })),
    expected_answer: labelForIndex(Number(object.label ?? 0)),
    source,
    default_max_tokens: 8
  };
}

function importWinoGrandeObject(
  object: Record<string, unknown>,
  request: BenchmarkImportRequest,
  source: BenchmarkSource,
  index: number
): BenchmarkItem {
  return {
    id: stringValue(object.qID ?? object.id, `${request.benchmarkId}_${index + 1}`),
    benchmark_id: request.benchmarkId,
    benchmark_name: request.benchmarkName,
    category: request.category || "coreference",
    answer_type: "multiple_choice",
    prompt: requiredString(object.sentence, "sentence").replace("_", "____"),
    choices: [
      { label: "A", text: requiredString(object.option1, "option1") },
      { label: "B", text: requiredString(object.option2, "option2") }
    ],
    expected_answer: String(object.answer) === "2" ? "B" : "A",
    source,
    default_max_tokens: 8
  };
}

function importTruthfulQaCsv(request: BenchmarkImportRequest, source: BenchmarkSource): BenchmarkItem[] {
  const records = parseCsv(request.files[0].content);
  const header = records[0] ?? [];
  const questionIndex = header.findIndex((cell) => cell.toLowerCase() === "question");
  const bestIndex = header.findIndex((cell) => cell.toLowerCase().includes("best answer"));
  const falseIndex = header.findIndex((cell) => cell.toLowerCase().includes("incorrect"));
  if (questionIndex < 0 || bestIndex < 0 || falseIndex < 0) {
    throw new Error("TruthfulQA CSV needs Question, Best Answer, and Best Incorrect Answer columns");
  }
  return records.slice(1).map((record, index) => ({
    id: `${request.benchmarkId}_${index + 1}`,
    benchmark_id: request.benchmarkId,
    benchmark_name: request.benchmarkName,
    category: request.category || "truthfulness",
    answer_type: "multiple_choice",
    prompt: record[questionIndex],
    choices: [
      { label: "A", text: record[bestIndex] },
      { label: "B", text: record[falseIndex] }
    ],
    expected_answer: "A",
    source,
    default_max_tokens: 8
  }));
}

function importGsm8kObject(
  object: Record<string, unknown>,
  request: BenchmarkImportRequest,
  source: BenchmarkSource,
  index: number
): BenchmarkItem {
  const answer = requiredString(object.answer, "answer");
  return {
    id: stringValue(object.id, `${request.benchmarkId}_${index + 1}`),
    benchmark_id: request.benchmarkId,
    benchmark_name: request.benchmarkName,
    category: request.category || "math",
    answer_type: "numeric",
    prompt: requiredString(object.question, "question"),
    expected_answer: answer.includes("####") ? answer.split("####").pop()?.trim() ?? answer : answer,
    source,
    default_max_tokens: 64
  };
}

function importBoolQObject(
  object: Record<string, unknown>,
  request: BenchmarkImportRequest,
  source: BenchmarkSource,
  index: number
): BenchmarkItem {
  const title = stringValue(object.title, "");
  const passage = requiredString(object.passage, "passage");
  return {
    id: stringValue(object.id, `${request.benchmarkId}_${index + 1}`),
    benchmark_id: request.benchmarkId,
    benchmark_name: request.benchmarkName,
    category: request.category || "reading",
    answer_type: "multiple_choice",
    prompt: `${title ? `Title: ${title}\n` : ""}Passage: ${passage}\nQuestion: ${requiredString(object.question, "question")}`,
    choices: [
      { label: "A", text: "Yes" },
      { label: "B", text: "No" }
    ],
    expected_answer: object.answer === true || object.answer === "true" ? "A" : "B",
    source,
    default_max_tokens: 8
  };
}

function importPiqaFiles(request: BenchmarkImportRequest, source: BenchmarkSource): BenchmarkItem[] {
  const dataFile = request.files.find((file) => file.name.endsWith(".jsonl")) ?? request.files[0];
  const labelsFile = request.files.find((file) => file.name.endsWith(".lst"));
  if (!labelsFile) {
    throw new Error("PIQA import requires a labels .lst file alongside the JSONL file");
  }
  const objects = jsonlObjects(dataFile);
  const labels = labelsFile.content.split(/\r?\n/).filter((line) => line.trim() !== "");
  return objects.map((object, index) => ({
    id: stringValue(object.id, `${request.benchmarkId}_${index + 1}`),
    benchmark_id: request.benchmarkId,
    benchmark_name: request.benchmarkName,
    category: request.category || "physical_commonsense",
    answer_type: "multiple_choice",
    prompt: requiredString(object.goal, "goal"),
    choices: [
      { label: "A", text: requiredString(object.sol1, "sol1") },
      { label: "B", text: requiredString(object.sol2, "sol2") }
    ],
    expected_answer: labels[index]?.trim() === "1" ? "B" : "A",
    source,
    default_max_tokens: 8
  }));
}

function importBbhJson(request: BenchmarkImportRequest, source: BenchmarkSource): BenchmarkItem[] {
  const parsed = JSON.parse(request.files[0].content) as { examples?: Array<Record<string, unknown>> };
  const examples = Array.isArray(parsed.examples) ? parsed.examples : [];
  return examples.map((object, index) => {
    const target = requiredString(object.target, "target");
    const numeric = /^[-+]?\d+(?:\.\d+)?$/.test(target.trim());
    return {
      id: `${request.benchmarkId}_${index + 1}`,
      benchmark_id: request.benchmarkId,
      benchmark_name: request.benchmarkName,
      category: request.category || "bbh",
      answer_type: numeric ? "numeric" : "string",
      prompt: requiredString(object.input, "input"),
      expected_answer: target,
      source,
      default_max_tokens: numeric ? 64 : 48
    };
  });
}

function importMbppObject(
  object: Record<string, unknown>,
  request: BenchmarkImportRequest,
  source: BenchmarkSource,
  index: number
): BenchmarkItem {
  const tests = stringArrayValue(object.test_list) ?? stringArrayValue(object.tests) ?? [];
  return {
    id: `mbpp_${stringValue(object.task_id, String(index + 1))}`,
    benchmark_id: request.benchmarkId,
    benchmark_name: request.benchmarkName,
    category: request.category || "code",
    answer_type: "code",
    prompt: requiredString(object.text ?? object.prompt, "text"),
    expected_answer: tests.join("\n"),
    source,
    default_max_tokens: 256,
    code_language: "python",
    code_tests: tests
  };
}

function jsonlObjects(file: ImportFilePayload): Array<Record<string, unknown>> {
  return file.content
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function officialChoices(rawChoices: unknown): BenchmarkChoice[] {
  const choices = rawChoices as { text?: unknown; label?: unknown };
  const texts = stringArrayValue(choices?.text);
  const labels = stringArrayValue(choices?.label);
  if (!texts || !labels || texts.length !== labels.length) {
    throw new Error("Choice object must include aligned text and label arrays");
  }
  return texts.map((text, index) => ({ label: labels[index], text }));
}

function choicesValue(value: unknown): BenchmarkChoice[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.map((choice) => {
    const record = choice as Record<string, unknown>;
    return {
      label: requiredString(record.label, "choice.label"),
      text: requiredString(record.text, "choice.text")
    };
  });
}

function sourceValue(value: unknown): BenchmarkSource | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  return {
    name: stringValue(record.name, "Imported source"),
    url: stringValue(record.url, "") || undefined,
    license: stringValue(record.license, "") || undefined,
    note: stringValue(record.note, "") || undefined
  };
}

function answerTypeValue(value: unknown): BenchmarkItem["answer_type"] {
  if (value === "multiple_choice" || value === "numeric" || value === "string" || value === "code") {
    return value;
  }
  throw new Error("Invalid answer_type");
}

function stringArrayValue(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.map((entry) => String(entry)) : undefined;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    throw new Error(`Missing required field ${field}`);
  }
  return String(value);
}

function stringValue(value: unknown, fallback: string): string {
  return value === undefined || value === null ? fallback : String(value);
}

function numberValue(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function sanitizeBenchmarkId(value: string): string {
  const sanitized = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  if (!sanitized) {
    throw new Error("benchmarkId must contain at least one letter or number");
  }
  return sanitized;
}

function labelForIndex(index: number): string {
  return String.fromCharCode("A".charCodeAt(0) + index);
}

function importFormatLabel(format: ImportFormat): string {
  return {
    rankedllm_jsonl: "RankedLLM JSONL",
    mmlu_csv: "MMLU CSV",
    arc_jsonl: "ARC JSONL",
    openbookqa_jsonl: "OpenBookQA JSONL",
    hellaswag_jsonl: "HellaSwag JSONL",
    winogrande_jsonl: "WinoGrande JSONL",
    truthfulqa_csv: "TruthfulQA CSV",
    gsm8k_jsonl: "GSM8K JSONL",
    boolq_jsonl: "BoolQ JSONL",
    piqa_jsonl: "PIQA JSONL + labels",
    bbh_json: "BIG-Bench Hard JSON",
    mbpp_jsonl: "MBPP JSONL"
  }[format];
}
