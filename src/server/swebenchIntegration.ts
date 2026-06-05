import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseCsv } from "./csvStore.js";
import { SYSTEM_PROMPT } from "./constants.js";
import type { LmStudioClient } from "./lmStudioClient.js";
import type {
  ImportFilePayload,
  OfficialEvaluationRunRequest,
  OfficialPredictionRunRequest,
  OfficialRunProgress,
  OfficialSuiteDefinition,
  OfficialSuiteId
} from "./types.js";

const OFFICIAL_SWEBENCH_ENV = "RANKEDLLM_ENABLE_OFFICIAL_SWEBENCH";
const DEFAULT_PATCH_MAX_TOKENS = 8192;
const PROCESS_LOG_TAIL_LIMIT = 12000;

type OfficialRunType = "prediction" | "evaluation";

interface ActiveOfficialRun {
  emitter: EventEmitter;
  progress: OfficialRunProgress;
}

interface SwebenchInstance {
  instance_id?: string;
  id?: string;
  repo?: string;
  base_commit?: string;
  problem_statement?: string;
  hints_text?: string;
  created_at?: string;
  version?: string;
  patch?: string;
  test_patch?: string;
  dockerhub_tag?: string;
  [key: string]: unknown;
}

interface ProcessResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

export const OFFICIAL_SUITE_DEFINITIONS: OfficialSuiteDefinition[] = [
  {
    id: "swe_bench",
    name: "SWE-bench",
    description: "Official SWE-bench patch predictions and Docker harness evaluation.",
    defaultDatasetName: "princeton-nlp/SWE-bench",
    defaultSplit: "test",
    supportsPredictionGeneration: true,
    supportsOfficialEvaluation: true,
    evaluationRequiresEnv: OFFICIAL_SWEBENCH_ENV,
    sourceUrl: "https://github.com/swe-bench/SWE-bench"
  },
  {
    id: "swe_bench_pro",
    name: "SWE-bench Pro",
    description: "Official SWE-bench Pro patch predictions and evaluator integration.",
    defaultDatasetName: "ScaleAI/SWE-bench_Pro",
    defaultSplit: "test",
    supportsPredictionGeneration: true,
    supportsOfficialEvaluation: true,
    evaluationRequiresEnv: OFFICIAL_SWEBENCH_ENV,
    sourceUrl: "https://github.com/scaleapi/SWE-bench_Pro-os"
  }
];

export class OfficialSwebenchManager {
  private readonly activeRuns = new Map<string, ActiveOfficialRun>();

  constructor(
    private readonly projectRoot: string,
    private readonly lmStudioClient: LmStudioClient
  ) {}

  getSuites(): OfficialSuiteDefinition[] {
    return OFFICIAL_SUITE_DEFINITIONS;
  }

  isEvaluationEnabled(): boolean {
    return process.env[OFFICIAL_SWEBENCH_ENV] === "1";
  }

  startPredictionRun(request: OfficialPredictionRunRequest): string {
    const suite = getSuite(request.suiteId);
    const runId = randomUUID();
    const activeRun: ActiveOfficialRun = {
      emitter: new EventEmitter(),
      progress: {
        runId,
        suiteId: suite.id,
        type: "prediction",
        status: "queued",
        totalItems: 0,
        completedItems: 0,
        errors: 0,
        message: "Prediction generation queued",
        startedAt: new Date().toISOString()
      }
    };

    this.activeRuns.set(runId, activeRun);
    queueMicrotask(() => {
      void this.generatePredictions(runId, request);
    });
    return runId;
  }

  startEvaluationRun(request: OfficialEvaluationRunRequest): string {
    const suite = getSuite(request.suiteId);
    const runId = randomUUID();
    const activeRun: ActiveOfficialRun = {
      emitter: new EventEmitter(),
      progress: {
        runId,
        suiteId: suite.id,
        type: "evaluation",
        status: "queued",
        totalItems: 1,
        completedItems: 0,
        errors: 0,
        message: "Official evaluation queued",
        startedAt: new Date().toISOString()
      }
    };

    this.activeRuns.set(runId, activeRun);
    queueMicrotask(() => {
      void this.runEvaluation(runId, request);
    });
    return runId;
  }

  getProgress(runId: string): OfficialRunProgress | undefined {
    return this.activeRuns.get(runId)?.progress;
  }

  subscribe(runId: string, listener: (progress: OfficialRunProgress) => void): () => void {
    const activeRun = this.activeRuns.get(runId);
    if (!activeRun) {
      return () => undefined;
    }
    activeRun.emitter.on("progress", listener);
    listener({ ...activeRun.progress });
    return () => activeRun.emitter.off("progress", listener);
  }

  private async generatePredictions(runId: string, request: OfficialPredictionRunRequest): Promise<void> {
    const activeRun = this.activeRuns.get(runId);
    if (!activeRun) {
      return;
    }

    try {
      this.update(runId, {
        status: "running",
        message: "Loading official dataset instances"
      });

      const suite = getSuite(request.suiteId);
      const outputPath = resolveProjectPath(
        this.projectRoot,
        request.outputPath || defaultPredictionPath(this.projectRoot, runId, suite.id)
      );
      await mkdir(path.dirname(outputPath), { recursive: true });
      const instances = selectInstances(await loadInstances(this.projectRoot, request), request);
      this.update(runId, {
        totalItems: instances.length,
        artifactPath: outputPath,
        message: `Generating ${instances.length} prediction(s)`
      });

      const predictions: unknown[] = [];
      const errorRows: unknown[] = [];
      const maxTokens = request.maxTokens ?? DEFAULT_PATCH_MAX_TOKENS;

      for (const instance of instances) {
        const instanceId = getInstanceId(instance);
        this.update(runId, {
          currentInstanceId: instanceId,
          message: `Generating patch for ${instanceId}`
        });

        try {
          const result = await this.lmStudioClient.chatCompletion({
            baseUrl: request.serverBaseUrl,
            modelId: request.modelId,
            systemPrompt: SYSTEM_PROMPT,
            userPrompt: buildSwebenchPrompt(instance),
            options: {
              temperature: request.temperature,
              timeoutMs: request.timeoutMs,
              samples: 1,
              maxTokens
            }
          });
          const patch = cleanModelPatch(result.output);
          predictions.push(formatPrediction(suite.id, instanceId, request.modelId, patch));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errorRows.push({ instance_id: instanceId, error: message });
          predictions.push(formatPrediction(suite.id, instanceId, request.modelId, ""));
          this.update(runId, {
            errors: activeRun.progress.errors + 1,
            lastError: message
          });
        } finally {
          this.update(runId, {
            completedItems: activeRun.progress.completedItems + 1
          });
        }
      }

      await writePredictionFile(outputPath, suite.id, predictions);
      if (errorRows.length > 0) {
        await writeJsonl(path.join(path.dirname(outputPath), `${path.basename(outputPath)}.errors.jsonl`), errorRows);
      }

      this.update(runId, {
        status: "completed",
        currentInstanceId: undefined,
        completedAt: new Date().toISOString(),
        message: `Predictions written to ${outputPath}`
      });
    } catch (error) {
      this.fail(runId, error);
    }
  }

  private async runEvaluation(runId: string, request: OfficialEvaluationRunRequest): Promise<void> {
    if (!this.isEvaluationEnabled()) {
      this.fail(
        runId,
        new Error(`Official SWE-bench evaluation is disabled. Restart with ${OFFICIAL_SWEBENCH_ENV}=1 after Docker and the upstream Python harness are installed.`)
      );
      return;
    }

    try {
      const command = buildOfficialEvaluationCommand(request, this.projectRoot, runId);
      this.update(runId, {
        status: "running",
        artifactPath: command.artifactPath,
        message: `Running ${command.displayName}`
      });
      await mkdir(command.artifactPath, { recursive: true });
      const result = await runProcess(command.executable, command.args, command.cwd, (tail) => {
        this.update(runId, { message: tail });
      });

      const logPath = path.join(command.artifactPath, "evaluation-process.log");
      await writeFile(logPath, `${result.stdout}\n${result.stderr}`, "utf8");

      if (result.exitCode !== 0) {
        throw new Error(`${command.displayName} exited with code ${result.exitCode ?? "unknown"}. See ${logPath}`);
      }

      this.update(runId, {
        status: "completed",
        completedItems: 1,
        completedAt: new Date().toISOString(),
        message: `Evaluation completed. Logs written to ${logPath}`
      });
    } catch (error) {
      this.fail(runId, error);
    }
  }

  private update(runId: string, patch: Partial<OfficialRunProgress>): void {
    const activeRun = this.activeRuns.get(runId);
    if (!activeRun) {
      return;
    }
    activeRun.progress = { ...activeRun.progress, ...patch };
    activeRun.emitter.emit("progress", { ...activeRun.progress });
  }

  private fail(runId: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.update(runId, {
      status: "failed",
      errors: Math.max(1, this.activeRuns.get(runId)?.progress.errors ?? 1),
      lastError: message,
      message,
      completedAt: new Date().toISOString()
    });
  }
}

export function buildSwebenchPrompt(instance: SwebenchInstance): string {
  const instanceId = getInstanceId(instance);
  const repo = valueToString(instance.repo) || "unknown repository";
  const baseCommit = valueToString(instance.base_commit) || "unknown base commit";
  const problem = valueToString(instance.problem_statement) || valueToString(instance.prompt) || "";
  const hints = valueToString(instance.hints_text);
  const metadata = [
    `Instance ID: ${instanceId}`,
    `Repository: ${repo}`,
    `Base commit: ${baseCommit}`,
    instance.version ? `Version: ${valueToString(instance.version)}` : "",
    instance.created_at ? `Created at: ${valueToString(instance.created_at)}` : ""
  ].filter(Boolean);

  return [
    "You are solving an official software engineering benchmark task.",
    "Return only a unified diff patch that can be applied with git apply.",
    "Do not include markdown fences, analysis, explanations, test logs, or commands.",
    "",
    metadata.join("\n"),
    "",
    "Issue:",
    problem,
    hints ? `\nHints:\n${hints}` : "",
    "\nPatch:"
  ].join("\n");
}

export function cleanModelPatch(output: string): string {
  const withoutFences = output
    .replace(/^```(?:diff|patch)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const diffIndex = withoutFences.indexOf("diff --git ");
  if (diffIndex >= 0) {
    return withoutFences.slice(diffIndex).trim();
  }
  const fileHeaderIndex = withoutFences.search(/^---\s+/m);
  if (fileHeaderIndex >= 0) {
    return withoutFences.slice(fileHeaderIndex).trim();
  }
  return withoutFences;
}

export function buildOfficialEvaluationCommand(
  request: OfficialEvaluationRunRequest,
  projectRoot: string,
  generatedRunId: string = randomUUID()
): { executable: string; args: string[]; cwd: string; artifactPath: string; displayName: string } {
  if (request.suiteId === "swe_bench") {
    const runId = request.runId || generatedRunId;
    const artifactPath = resolveProjectPath(projectRoot, request.outputDir || path.join("official-runs", runId, "swe-bench-evaluation"));
    const args = [
      "-m",
      "swebench.harness.run_evaluation",
      "--dataset_name",
      request.datasetName || getSuite("swe_bench").defaultDatasetName,
      "--split",
      request.split || getSuite("swe_bench").defaultSplit,
      "--predictions_path",
      resolveProjectPath(projectRoot, request.predictionsPath),
      "--max_workers",
      String(request.maxWorkers ?? 1),
      "--run_id",
      runId
    ];
    if (request.instanceIds?.length) {
      args.push("--instance_ids", ...request.instanceIds);
    }
    if (request.namespace !== undefined) {
      args.push("--namespace", request.namespace);
    }
    return {
      executable: "python3",
      args,
      cwd: projectRoot,
      artifactPath,
      displayName: "SWE-bench official evaluator"
    };
  }

  if (!request.swebenchProRepoPath) {
    throw new Error("swebenchProRepoPath is required for SWE-bench Pro evaluation.");
  }
  if (!request.rawSamplePath) {
    throw new Error("rawSamplePath is required for SWE-bench Pro evaluation.");
  }
  const repoPath = resolveProjectPath(projectRoot, request.swebenchProRepoPath);
  const runId = request.runId || generatedRunId;
  const artifactPath = resolveProjectPath(projectRoot, request.outputDir || path.join("official-runs", runId, "swe-bench-pro-evaluation"));
  const args = [
    "swe_bench_pro_eval.py",
    `--raw_sample_path=${resolveProjectPath(projectRoot, request.rawSamplePath)}`,
    `--patch_path=${resolveProjectPath(projectRoot, request.predictionsPath)}`,
    `--output_dir=${artifactPath}`,
    `--scripts_dir=${resolveProjectPath(projectRoot, request.scriptsDir || path.join(repoPath, "run_scripts"))}`,
    `--num_workers=${request.maxWorkers ?? 1}`,
    `--dockerhub_username=${request.dockerhubUsername || "jefzda"}`
  ];
  if (request.useLocalDocker) {
    args.push("--use_local_docker");
  }
  return {
    executable: "python3",
    args,
    cwd: repoPath,
    artifactPath,
    displayName: "SWE-bench Pro official evaluator"
  };
}

async function loadInstances(projectRoot: string, request: OfficialPredictionRunRequest): Promise<SwebenchInstance[]> {
  if (request.source.type === "inline_file") {
    if (!request.source.file) {
      throw new Error("A local JSON, JSONL, or CSV file is required for inline official prediction generation.");
    }
    return parseInstanceFile(request.source.file);
  }

  const suite = getSuite(request.suiteId);
  const datasetName = request.source.datasetName || suite.defaultDatasetName;
  const split = request.source.split || suite.defaultSplit;
  const outputPath = path.join(projectRoot, "official-runs", `hf-${randomUUID()}.jsonl`);
  await mkdir(path.dirname(outputPath), { recursive: true });
  const script = [
    "import json, sys",
    "from datasets import load_dataset",
    "dataset_name, split, output_path = sys.argv[1], sys.argv[2], sys.argv[3]",
    "dataset = load_dataset(dataset_name, split=split)",
    "with open(output_path, 'w', encoding='utf-8') as handle:",
    "    for row in dataset:",
    "        handle.write(json.dumps(dict(row), ensure_ascii=False) + '\\n')"
  ].join("\n");
  const result = await runProcess("python3", ["-c", script, datasetName, split, outputPath], projectRoot);
  if (result.exitCode !== 0) {
    throw new Error(
      `Could not load ${datasetName}/${split}. Install Hugging Face datasets in your Python environment. ${result.stderr || result.stdout}`
    );
  }
  return parseJsonl(await readFile(outputPath, "utf8"));
}

function parseInstanceFile(file: ImportFilePayload): SwebenchInstance[] {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".csv")) {
    return parseInstanceCsv(file.content);
  }
  const trimmed = file.content.trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed.startsWith("[")) {
    return JSON.parse(trimmed) as SwebenchInstance[];
  }
  return parseJsonl(trimmed);
}

function parseInstanceCsv(content: string): SwebenchInstance[] {
  const records = parseCsv(content);
  if (records.length === 0) {
    return [];
  }
  const [header, ...rows] = records;
  return rows.map((row) => {
    const item: SwebenchInstance = {};
    header.forEach((key, index) => {
      item[key] = row[index] ?? "";
    });
    return item;
  });
}

function parseJsonl(content: string): SwebenchInstance[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SwebenchInstance);
}

function selectInstances(instances: SwebenchInstance[], request: OfficialPredictionRunRequest): SwebenchInstance[] {
  const allowedIds = new Set(request.instanceIds ?? []);
  const filtered = allowedIds.size > 0 ? instances.filter((instance) => allowedIds.has(getInstanceId(instance))) : instances;
  return request.limit && request.limit > 0 ? filtered.slice(0, request.limit) : filtered;
}

function getInstanceId(instance: SwebenchInstance): string {
  return valueToString(instance.instance_id || instance.id || "unknown-instance");
}

function formatPrediction(suiteId: OfficialSuiteId, instanceId: string, modelId: string, patch: string): unknown {
  if (suiteId === "swe_bench_pro") {
    return { instance_id: instanceId, patch, prefix: modelId };
  }
  return { instance_id: instanceId, model_name_or_path: modelId, model_patch: patch };
}

async function writePredictionFile(outputPath: string, suiteId: OfficialSuiteId, predictions: unknown[]): Promise<void> {
  if (suiteId === "swe_bench_pro") {
    await writeFile(outputPath, `${JSON.stringify(predictions, null, 2)}\n`, "utf8");
    return;
  }
  await writeJsonl(outputPath, predictions);
}

async function writeJsonl(filePath: string, rows: unknown[]): Promise<void> {
  await writeFile(filePath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
}

function defaultPredictionPath(projectRoot: string, runId: string, suiteId: OfficialSuiteId): string {
  const fileName = suiteId === "swe_bench_pro" ? "predictions.json" : "predictions.jsonl";
  return path.join(projectRoot, "official-runs", runId, fileName);
}

function resolveProjectPath(projectRoot: string, targetPath: string): string {
  return path.isAbsolute(targetPath) ? targetPath : path.resolve(projectRoot, targetPath);
}

function getSuite(suiteId: OfficialSuiteId): OfficialSuiteDefinition {
  const suite = OFFICIAL_SUITE_DEFINITIONS.find((entry) => entry.id === suiteId);
  if (!suite) {
    throw new Error(`Unsupported official suite: ${suiteId}`);
  }
  return suite;
}

function valueToString(value: unknown): string {
  return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
}

function runProcess(
  executable: string,
  args: string[],
  cwd: string,
  onOutput?: (tail: string) => void
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let tail = "";

    const append = (chunk: Buffer, stream: "stdout" | "stderr") => {
      const text = chunk.toString("utf8");
      if (stream === "stdout") {
        stdout += text;
      } else {
        stderr += text;
      }
      tail = `${tail}${text}`.slice(-PROCESS_LOG_TAIL_LIMIT);
      onOutput?.(tail.trim() || "Official evaluation running");
    };

    child.stdout.on("data", (chunk: Buffer) => append(chunk, "stdout"));
    child.stderr.on("data", (chunk: Buffer) => append(chunk, "stderr"));
    child.on("error", reject);
    child.on("close", (exitCode, signal) => resolve({ exitCode, signal, stdout, stderr }));
  });
}
