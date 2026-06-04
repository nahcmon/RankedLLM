import { describe, expect, it } from "vitest";
import { LmStudioClient, isLikelyReasoningModel, nativeApiBaseUrl, recommendModel } from "../lmStudioClient.js";

describe("LM Studio model recommendation", () => {
  it("prefers the configured fast local test model when available", () => {
    expect(
      recommendModel([
        { id: "qwen3.5-0.8b-instruct" },
        { id: "lfm2.5-8b-a1b" },
        { id: "qwen2.5-7b-instruct" }
      ])
    ).toBe("lfm2.5-8b-a1b");
  });

  it("keeps reasoning_content separate from final answer content", async () => {
    const client = new LmStudioClient(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: "B",
                reasoning_content: "Answer: A"
              }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    await expect(
      client.chatCompletion({
        baseUrl: "http://provider.test/v1",
        modelId: "lfm2.5-8b-a1b",
        systemPrompt: "system",
        userPrompt: "user",
        options: { temperature: 0, timeoutMs: 1000, samples: 1, maxTokens: 32 }
      })
    ).resolves.toMatchObject({
      output: "B",
      reasoningOutput: "Answer: A",
      finishReason: "stop"
    });
  });

  it("reloads an unloaded model and retries the chat completion once", async () => {
    const calls: string[] = [];
    const client = new LmStudioClient(async (url) => {
      calls.push(String(url));
      if (String(url).endsWith("/chat/completions") && calls.filter((entry) => entry.endsWith("/chat/completions")).length === 1) {
        return new Response(JSON.stringify({ error: { message: "Model unloaded." } }), {
          status: 400,
          headers: { "content-type": "application/json" }
        });
      }
      if (String(url).endsWith("/api/v1/models/load")) {
        return new Response(JSON.stringify({ status: "loaded" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "A" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });

    await expect(
      client.chatCompletion({
        baseUrl: "http://provider.test/v1",
        modelId: "qwen3.5-9b",
        systemPrompt: "system",
        userPrompt: "user",
        options: { temperature: 0, timeoutMs: 1000, samples: 1, maxTokens: 32 }
      })
    ).resolves.toMatchObject({ output: "A" });

    expect(calls).toEqual([
      "http://provider.test/v1/chat/completions",
      "http://provider.test/api/v1/models/load",
      "http://provider.test/v1/chat/completions"
    ]);
  });

  it("detects common reasoning model ids", () => {
    expect(isLikelyReasoningModel("lfm2.5-8b-a1b")).toBe(true);
    expect(isLikelyReasoningModel("deepseek-r1-distill-qwen")).toBe(true);
    expect(isLikelyReasoningModel("google/gemma-4-12b")).toBe(true);
    expect(isLikelyReasoningModel("plain-instruct-model")).toBe(false);
  });

  it("derives LM Studio native API base URLs from OpenAI-compatible base URLs", () => {
    expect(nativeApiBaseUrl("http://localhost:1234/v1")).toBe("http://localhost:1234/api/v1");
    expect(nativeApiBaseUrl("http://localhost:1234/custom/v1")).toBe("http://localhost:1234/custom/api/v1");
  });
});
