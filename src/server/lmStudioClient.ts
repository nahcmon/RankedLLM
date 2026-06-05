import { PREFERRED_TEST_MODEL_ID } from "./constants.js";
import type { LmStudioModel, RunOptions } from "./types.js";

export interface ChatCompletionRequest {
  baseUrl: string;
  modelId: string;
  systemPrompt: string;
  userPrompt: string;
  options: RunOptions & { maxTokens: number };
}

export interface ChatCompletionResult {
  output: string;
  reasoningOutput: string;
  finishReason?: string;
  latencyMs: number;
}

export class LmStudioHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
    readonly providerMessage = ""
  ) {
    super(message);
    this.name = "LmStudioHttpError";
  }
}

export class LmStudioClient {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async listModels(baseUrl: string, timeoutMs = 10000): Promise<LmStudioModel[]> {
    const response = await this.fetchWithTimeout(joinUrl(baseUrl, "models"), { method: "GET" }, timeoutMs);
    if (!response.ok) {
      throw new Error(`LM Studio returned ${response.status} while fetching models`);
    }
    const payload = (await response.json()) as { data?: LmStudioModel[] };
    return payload.data ?? [];
  }

  async testConnection(baseUrl: string, timeoutMs = 10000): Promise<{ ok: true; models: LmStudioModel[] }> {
    const models = await this.listModels(baseUrl, timeoutMs);
    return { ok: true, models };
  }

  async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
    const result = await this.chatCompletionWithReload(request);
    return result;
  }

  private async chatCompletionWithReload(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
    try {
      return await this.chatCompletionOnce(request);
    } catch (error) {
      if (!isModelUnloadedError(error)) {
        throw error;
      }

      await this.loadModel(request.baseUrl, request.modelId, Math.max(request.options.timeoutMs, 120000)).catch(() => undefined);
      await delay(750);
      try {
        return await this.chatCompletionOnce(request);
      } catch (retryError) {
        if (isModelUnloadedError(retryError)) {
          throw new Error(`LM Studio reported model "${request.modelId}" unloaded after an automatic reload attempt.`);
        }
        throw retryError;
      }
    }
  }

  private async chatCompletionOnce(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
    const body: Record<string, unknown> = {
      model: request.modelId,
      messages: [
        { role: "system", content: request.systemPrompt },
        { role: "user", content: request.userPrompt }
      ],
      temperature: request.options.temperature,
      max_tokens: request.options.maxTokens,
      stream: true
    };

    if (typeof request.options.seed === "number") {
      body.seed = request.options.seed;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.options.timeoutMs);
    try {
      const response = await this.fetchImpl(joinUrl(request.baseUrl, "chat/completions"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        const providerMessage = extractProviderErrorMessage(errorBody);
        throw new LmStudioHttpError(
          `LM Studio returned ${response.status}${errorBody ? `: ${errorBody}` : ""}`,
          response.status,
          errorBody,
          providerMessage
        );
      }

      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (contentType.includes("text/event-stream")) {
        if (!response.body) {
          throw new Error("Provider returned a streaming response without a readable body.");
        }
        return await parseStreamingChatCompletion(response.body);
      }

      return await parseNonStreamingChatCompletion(response);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Request timed out after ${request.options.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async loadModel(baseUrl: string, modelId: string, timeoutMs = 120000): Promise<void> {
    const response = await this.fetchWithTimeout(
      joinUrl(nativeApiBaseUrl(baseUrl), "models/load"),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: modelId })
      },
      timeoutMs
    );

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(`LM Studio model reload returned ${response.status}${errorBody ? `: ${errorBody}` : ""}`);
    }
  }

  private async fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Request timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function isLikelyReasoningModel(modelId: string): boolean {
  const compact = modelId.toLowerCase().replace(/[\s_-]+/g, "");
  return (
    compact.includes("deepseekr1") ||
    compact.includes("qwen3") ||
    compact.includes("gemma4") ||
    compact.includes("gemma3") ||
    compact.includes("reasoning") ||
    compact.includes("reasoner") ||
    compact.includes("lfm2.5") ||
    compact.includes("a1b")
  );
}

export function nativeApiBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/v1$/i, "");
  return joinUrl(url.toString(), "/api/v1");
}

export function joinUrl(baseUrl: string, pathPart: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${pathPart.replace(/^\/+/, "")}`;
}

export function recommendModel(models: LmStudioModel[]): string | undefined {
  const scored = models.map((model) => {
    const id = model.id.toLowerCase();
    const compact = id.replace(/[\s_-]+/g, "");
    let score = 0;
    if (id === PREFERRED_TEST_MODEL_ID) score += 100;
    if (compact.includes("qwen")) score += 10;
    if (compact.includes("qwen3.5") || compact.includes("qwen35")) score += 5;
    if (compact.includes("0.8b") || compact.includes("0_8b") || compact.includes("0.8") || compact.includes("08b")) {
      score += 8;
    }
    if (compact.includes("instruct")) score += 2;
    return { id: model.id, score };
  });
  const best = scored.sort((a, b) => b.score - a.score)[0];
  return best && best.score > 0 ? best.id : models[0]?.id;
}

export async function parseStreamingChatCompletion(
  body: ReadableStream<Uint8Array>,
  now: () => number = () => performance.now()
): Promise<ChatCompletionResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const dataLines: string[] = [];
  let buffer = "";
  let output = "";
  let reasoningOutput = "";
  let finishReason: string | undefined;
  let firstTokenAt: number | undefined;
  let lastTokenAt: number | undefined;

  const markToken = () => {
    const timestamp = now();
    firstTokenAt ??= timestamp;
    lastTokenAt = timestamp;
  };

  const processEvent = (data: string) => {
    const trimmed = data.trim();
    if (!trimmed || trimmed === "[DONE]") {
      return;
    }

    const payload = JSON.parse(trimmed) as {
      choices?: Array<{
        finish_reason?: string | null;
        delta?: {
          content?: string | null;
          reasoning_content?: string | null;
          reasoning?: string | null;
        };
        message?: {
          content?: string | null;
          reasoning_content?: string | null;
          reasoning?: string | null;
        };
        text?: string | null;
      }>;
    };

    for (const choice of payload.choices ?? []) {
      const content = choice.delta?.content ?? choice.message?.content ?? choice.text ?? "";
      const reasoning = choice.delta?.reasoning_content ?? choice.delta?.reasoning ?? choice.message?.reasoning_content ?? choice.message?.reasoning ?? "";
      if (content) {
        output += content;
        markToken();
      }
      if (reasoning) {
        reasoningOutput += reasoning;
        markToken();
      }
      if (choice.finish_reason) {
        finishReason = choice.finish_reason;
      }
    }
  };

  const flushEvent = () => {
    if (dataLines.length === 0) {
      return;
    }
    processEvent(dataLines.join("\n"));
    dataLines.length = 0;
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\n/);
    buffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      if (line === "") {
        flushEvent();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
  }

  buffer += decoder.decode();
  if (buffer) {
    for (const rawLine of buffer.split(/\r?\n/)) {
      if (rawLine === "") {
        flushEvent();
      } else if (rawLine.startsWith("data:")) {
        dataLines.push(rawLine.slice(5).trimStart());
      }
    }
  }
  flushEvent();

  const latencyMs =
    firstTokenAt !== undefined && lastTokenAt !== undefined ? Math.max(1, Math.round(lastTokenAt - firstTokenAt)) : 0;
  return { output, reasoningOutput, finishReason, latencyMs };
}

async function parseNonStreamingChatCompletion(response: Response): Promise<ChatCompletionResult> {
  const payload = (await response.json()) as {
    choices?: Array<{
      finish_reason?: string;
      message?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null };
      text?: string | null;
    }>;
  };
  const choice = payload.choices?.[0];
  const output = choice?.message?.content ?? choice?.text ?? "";
  const reasoningOutput = choice?.message?.reasoning_content ?? choice?.message?.reasoning ?? "";
  return { output, reasoningOutput, finishReason: choice?.finish_reason, latencyMs: 0 };
}

function isModelUnloadedError(error: unknown): boolean {
  if (!(error instanceof LmStudioHttpError)) {
    return false;
  }
  const text = `${error.providerMessage} ${error.body}`.toLowerCase();
  return error.status === 400 && text.includes("model unloaded");
}

function extractProviderErrorMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } };
    return typeof parsed.error?.message === "string" ? parsed.error.message : "";
  } catch {
    return "";
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
