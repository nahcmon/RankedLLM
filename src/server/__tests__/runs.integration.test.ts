import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";

let tempRoot = "";

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "rankedllm-app-"));
  await mkdir(path.join(tempRoot, "benchmarks"));
  await writeFile(
    path.join(tempRoot, "benchmarks", "smoke.jsonl"),
    JSON.stringify({
      id: "mock_mc_001",
      benchmark_id: "smoke",
      benchmark_name: "Quick smoke tests",
      category: "smoke",
      answer_type: "multiple_choice",
      prompt: "Which option is correct?",
      choices: [
        { label: "A", text: "Correct" },
        { label: "B", text: "Wrong" }
      ],
      expected_answer: "A"
    }) + "\n",
    "utf8"
  );
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe("run API integration", () => {
  it("starts a run, scores mocked LM Studio output, and persists history", async () => {
    const fakeFetch = vi.fn<typeof fetch>(async (url, init) => {
      const stringUrl = String(url);
      if (stringUrl.endsWith("/models")) {
        return jsonResponse({ data: [{ id: "qwen3.5-0.8b-instruct" }] });
      }
      if (stringUrl.endsWith("/chat/completions")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
        expect(body.model).toBe("qwen3.5-0.8b-instruct");
        return jsonResponse({ choices: [{ message: { content: "A" } }] });
      }
      return jsonResponse({ message: "not found" }, 404);
    });

    const { app } = await createApp({ projectRoot: tempRoot, fetchImpl: fakeFetch });

    const modelsResponse = await request(app)
      .post("/api/lmstudio/models")
      .send({ baseUrl: "http://lmstudio.test/v1", timeoutMs: 5000 });
    expect(modelsResponse.body.recommendedModelId).toBe("qwen3.5-0.8b-instruct");

    const startResponse = await request(app)
      .post("/api/runs")
      .send({
        serverBaseUrl: "http://lmstudio.test/v1",
        modelId: "qwen3.5-0.8b-instruct",
        benchmarkIds: ["smoke"],
        options: { temperature: 0, timeoutMs: 5000, samples: 1 }
      });

    expect(startResponse.status).toBe(202);

    await vi.waitFor(async () => {
      const historyResponse = await request(app).get("/api/runs");
      expect(historyResponse.body.summaries).toHaveLength(1);
      expect(historyResponse.body.summaries[0]).toMatchObject({
        totalPrompts: 1,
        correctPrompts: 1,
        errors: 0
      });
      expect(historyResponse.body.rows[0].raw_output).toBe("A");
    });
  });

  it("ignores reasoning fields while scoring reasoning model output", async () => {
    const fakeFetch = vi.fn<typeof fetch>(async (url, init) => {
      const stringUrl = String(url);
      if (stringUrl.endsWith("/chat/completions")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { max_tokens?: number };
        expect(body.max_tokens).toBe(4096);
        return jsonResponse({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: "B",
                reasoning_content: "Answer: A"
              }
            }
          ]
        });
      }
      return jsonResponse({ message: "not found" }, 404);
    });

    const { app } = await createApp({ projectRoot: tempRoot, fetchImpl: fakeFetch });
    const startResponse = await request(app)
      .post("/api/runs")
      .send({
        serverBaseUrl: "http://lmstudio.test/v1",
        modelId: "lfm2.5-8b-a1b",
        benchmarkIds: ["smoke"],
        options: { temperature: 0, timeoutMs: 5000, samples: 1 }
      });

    expect(startResponse.status).toBe(202);

    await vi.waitFor(async () => {
      const historyResponse = await request(app).get("/api/runs");
      expect(historyResponse.body.summaries[0]).toMatchObject({
        totalPrompts: 1,
        correctPrompts: 0,
        errors: 0
      });
      expect(historyResponse.body.rows[0]).toMatchObject({
        raw_output: "B",
        normalized_output: "B",
        is_correct: "false"
      });
    });
  });

  it("rejects code benchmark runs unless server code execution is enabled", async () => {
    await writeFile(
      path.join(tempRoot, "benchmarks", "mbpp_sample.jsonl"),
      JSON.stringify({
        id: "mock_code_001",
        benchmark_id: "mbpp_sample",
        benchmark_name: "MBPP local code subset",
        category: "code",
        answer_type: "code",
        prompt: "Write a function add(a, b) that returns their sum.",
        expected_answer: "assert add(1, 2) == 3",
        code_language: "python",
        code_tests: ["assert add(1, 2) == 3"]
      }) + "\n",
      "utf8"
    );
    const { app } = await createApp({ projectRoot: tempRoot, fetchImpl: vi.fn<typeof fetch>() });

    const disabledByRequest = await request(app)
      .post("/api/runs")
      .send({
        serverBaseUrl: "http://lmstudio.test/v1",
        modelId: "lfm2.5-8b-a1b",
        benchmarkIds: ["mbpp_sample"],
        options: { temperature: 0, timeoutMs: 5000, samples: 1 }
      });
    expect(disabledByRequest.status).toBe(400);
    expect(disabledByRequest.body.message).toContain("disabled by default");

    const disabledByServer = await request(app)
      .post("/api/runs")
      .send({
        serverBaseUrl: "http://lmstudio.test/v1",
        modelId: "lfm2.5-8b-a1b",
        benchmarkIds: ["mbpp_sample"],
        options: { temperature: 0, timeoutMs: 5000, samples: 1, enableCodeExecution: true }
      });
    expect(disabledByServer.status).toBe(400);
    expect(disabledByServer.body.message).toContain("RANKEDLLM_ENABLE_CODE_BENCHMARKS=1");
  });
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}
