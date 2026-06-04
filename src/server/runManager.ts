import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { REASONING_MODEL_DEFAULT_MAX_TOKENS, SYSTEM_PROMPT } from "./constants.js";
import { buildStoredPrompt, buildUserPrompt, serializeChoices } from "./prompting.js";
import { scoreOutput } from "./scoring.js";
import { CodeBenchmarkExecutor } from "./codeExecutor.js";
import type { CsvStore } from "./csvStore.js";
import type { BenchmarkDefinition, BenchmarkItem, PromptResultRow, RunProgress, RunRequest } from "./types.js";
import { isLikelyReasoningModel, type LmStudioClient } from "./lmStudioClient.js";

interface ActiveRun {
  emitter: EventEmitter;
  progress: RunProgress;
  rows: PromptResultRow[];
}

export class RunManager {
  private readonly activeRuns = new Map<string, ActiveRun>();

  constructor(
    private readonly csvStore: CsvStore,
    private readonly lmStudioClient: LmStudioClient,
    private readonly benchmarks: Map<string, BenchmarkItem[]>,
    private readonly benchmarkDefinitions: BenchmarkDefinition[],
    private readonly codeExecutor = new CodeBenchmarkExecutor()
  ) {}

  startRun(request: RunRequest): string {
    const runId = randomUUID();
    const selectedItems = request.benchmarkIds.flatMap((benchmarkId) => this.benchmarks.get(benchmarkId) ?? []);
    const totalPrompts = selectedItems.length * request.options.samples;
    const activeRun: ActiveRun = {
      emitter: new EventEmitter(),
      rows: [],
      progress: {
        runId,
        status: "queued",
        totalPrompts,
        completedPrompts: 0,
        correctPrompts: 0,
        errors: 0,
        averageLatencyMs: 0
      }
    };

    this.activeRuns.set(runId, activeRun);
    queueMicrotask(() => {
      void this.executeRun(runId, request, selectedItems);
    });
    return runId;
  }

  getProgress(runId: string): RunProgress | undefined {
    return this.activeRuns.get(runId)?.progress;
  }

  subscribe(runId: string, listener: (progress: RunProgress) => void): () => void {
    const activeRun = this.activeRuns.get(runId);
    if (!activeRun) {
      return () => undefined;
    }
    activeRun.emitter.on("progress", listener);
    listener(activeRun.progress);
    return () => activeRun.emitter.off("progress", listener);
  }

  private async executeRun(runId: string, request: RunRequest, selectedItems: BenchmarkItem[]): Promise<void> {
    const activeRun = this.activeRuns.get(runId);
    if (!activeRun) {
      return;
    }

    activeRun.progress.status = "running";
    this.emit(runId);
    const runTimestamp = new Date().toISOString();

    for (let sampleIndex = 0; sampleIndex < request.options.samples; sampleIndex += 1) {
      for (const item of selectedItems) {
        activeRun.progress.currentBenchmark = item.benchmark_name;
        activeRun.progress.currentPromptId = item.id;
        this.emit(runId);
        const definition = this.benchmarkDefinitions.find((benchmark) => benchmark.id === item.benchmark_id);
        const baseMaxTokens = item.default_max_tokens ?? definition?.defaultMaxTokens ?? 32;
        const maxTokens = request.options.maxTokens ?? reasoningAwareMaxTokens(request.modelId, item, baseMaxTokens);
        const userPrompt = buildUserPrompt(item);
        const promptId =
          request.options.samples > 1 ? `${item.id}#sample-${sampleIndex + 1}` : item.id;
        activeRun.progress.currentPromptPreview = {
          promptId,
          benchmarkId: item.benchmark_id,
          benchmarkName: item.benchmark_name,
          answerType: item.answer_type,
          prompt: userPrompt,
          choices: item.choices ?? [],
          expectedAnswer: item.expected_answer
        };
        this.emit(runId);

        let rawOutput = "";
        let normalizedOutput = "";
        let isCorrect = false;
        let score = 0;
        let latencyMs = 0;
        let error = "";

        try {
          const result = await this.lmStudioClient.chatCompletion({
            baseUrl: request.serverBaseUrl,
            modelId: request.modelId,
            systemPrompt: SYSTEM_PROMPT,
            userPrompt,
            options: { ...request.options, maxTokens }
          });
          rawOutput = result.output;
          latencyMs = result.latencyMs;
          if (!rawOutput.trim() && result.reasoningOutput.trim()) {
            error = result.finishReason === "length"
              ? `No final answer content returned before max_tokens (${maxTokens}); reasoning content was ignored. Increase Max tokens if this persists.`
              : "No final answer content returned; reasoning content was ignored.";
          }
          if (item.answer_type === "code") {
            const execution = await this.codeExecutor.runPython(rawOutput, item.code_tests ?? [], request.options.timeoutMs);
            normalizedOutput = execution.output;
            isCorrect = execution.passed;
            score = execution.passed ? 1 : 0;
            error = execution.error || error;
          } else {
            const scored = scoreOutput(item, rawOutput);
            normalizedOutput = scored.normalizedOutput;
            isCorrect = scored.isCorrect;
            score = scored.score;
          }
        } catch (caught) {
          error = caught instanceof Error ? caught.message : String(caught);
        }

        const row: PromptResultRow = {
          run_id: runId,
          timestamp: runTimestamp,
          server_base_url: request.serverBaseUrl,
          model_id: request.modelId,
          benchmark_id: item.benchmark_id,
          benchmark_name: item.benchmark_name,
          benchmark_category: item.category,
          prompt_id: promptId,
          prompt: buildStoredPrompt(userPrompt),
          choices: serializeChoices(item.choices),
          expected_answer: item.expected_answer,
          raw_output: rawOutput,
          normalized_output: normalizedOutput,
          is_correct: isCorrect ? "true" : "false",
          score: String(score),
          latency_ms: String(latencyMs),
          error
        };

        await this.csvStore.appendRow(row);
        activeRun.rows.push(row);
        activeRun.progress.completedPrompts += 1;
        activeRun.progress.correctPrompts += score >= 1 ? 1 : 0;
        activeRun.progress.errors += error ? 1 : 0;
        activeRun.progress.lastResult = row;
        activeRun.progress.averageLatencyMs = averageLatency(activeRun.rows);
        this.emit(runId);
      }
    }

    activeRun.progress.status = "completed";
    activeRun.progress.currentBenchmark = undefined;
    activeRun.progress.currentPromptId = undefined;
    activeRun.progress.currentPromptPreview = undefined;
    activeRun.progress.message = "Run completed";
    this.emit(runId);
  }

  private emit(runId: string): void {
    const activeRun = this.activeRuns.get(runId);
    if (!activeRun) {
      return;
    }
    activeRun.emitter.emit("progress", { ...activeRun.progress });
  }
}

function averageLatency(rows: PromptResultRow[]): number {
  const latencies = rows.map((row) => Number(row.latency_ms)).filter((latency) => Number.isFinite(latency) && latency > 0);
  if (latencies.length === 0) {
    return 0;
  }
  return latencies.reduce((sum, latency) => sum + latency, 0) / latencies.length;
}

function reasoningAwareMaxTokens(modelId: string, item: BenchmarkItem, baseMaxTokens: number): number {
  if (item.answer_type === "code" || !isLikelyReasoningModel(modelId)) {
    return baseMaxTokens;
  }
  return Math.max(baseMaxTokens, REASONING_MODEL_DEFAULT_MAX_TOKENS);
}
