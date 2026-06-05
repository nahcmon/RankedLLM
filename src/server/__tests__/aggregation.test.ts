import { describe, expect, it } from "vitest";
import { aggregateRunSummaries } from "../aggregation.js";
import type { PromptResultRow } from "../types.js";

describe("aggregateRunSummaries", () => {
  it("aggregates prompt rows by run and benchmark", () => {
    const summaries = aggregateRunSummaries([
      rowFactory({ prompt_id: "p1", score: "1", latency_ms: "100" }),
      rowFactory({ prompt_id: "p2", score: "0", latency_ms: "300", error: "timeout" })
    ]);

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      totalPrompts: 1,
      correctPrompts: 1,
      accuracy: 100,
      averageLatencyMs: 100,
      errors: 1
    });
  });

  it("keeps all-error groups visible without using them for accuracy or latency", () => {
    const summaries = aggregateRunSummaries([
      rowFactory({ prompt_id: "p1", score: "0", latency_ms: "1200", error: "provider unavailable" })
    ]);

    expect(summaries[0]).toMatchObject({
      totalPrompts: 0,
      correctPrompts: 0,
      accuracy: 0,
      averageLatencyMs: 0,
      errors: 1
    });
  });
});

function rowFactory(overrides: Partial<PromptResultRow> = {}): PromptResultRow {
  return {
    run_id: "run-1",
    timestamp: "2026-06-04T10:00:00.000Z",
    server_base_url: "http://localhost:1234/v1",
    model_id: "model",
    benchmark_id: "smoke",
    benchmark_name: "Smoke",
    benchmark_category: "smoke",
    prompt_id: "p1",
    prompt: "prompt",
    choices: "",
    expected_answer: "A",
    raw_output: "A",
    normalized_output: "A",
    is_correct: "true",
    score: "1",
    latency_ms: "10",
    error: "",
    ...overrides
  };
}
