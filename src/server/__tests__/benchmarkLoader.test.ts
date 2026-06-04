import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getBenchmarkItems, loadBenchmarks } from "../benchmarkLoader.js";

let tempRoot = "";

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "rankedllm-bench-"));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe("benchmark loader", () => {
  it("loads JSONL items and groups them by benchmark", async () => {
    const benchmarksDir = path.join(tempRoot, "benchmarks");
    await mkdir(benchmarksDir);
    await writeFile(
      path.join(benchmarksDir, "smoke.jsonl"),
      JSON.stringify({
        id: "p1",
        benchmark_id: "smoke",
        benchmark_name: "Smoke",
        category: "smoke",
        answer_type: "multiple_choice",
        prompt: "Pick A",
        choices: [
          { label: "A", text: "A" },
          { label: "B", text: "B" }
        ],
        expected_answer: "A"
      }) + "\n",
      "utf8"
    );

    const loaded = await loadBenchmarks(benchmarksDir);
    expect(loaded.definitions[0]).toMatchObject({ id: "smoke", itemCount: 1, enabled: true });
    expect(getBenchmarkItems(loaded.itemsByBenchmark, ["smoke"])).toHaveLength(1);
  });

  it("loads the bundled benchmark directory including larger hard subsets", async () => {
    const loaded = await loadBenchmarks(path.resolve(process.cwd(), "benchmarks"));
    const byId = new Map(loaded.definitions.map((definition) => [definition.id, definition]));

    expect(byId.get("mmlu_pro_hard_sample")).toMatchObject({ itemCount: 16, answerType: "multiple_choice" });
    expect(byId.get("gpqa_hard_sample")).toMatchObject({ itemCount: 12, answerType: "multiple_choice" });
    expect(byId.get("math_competition_sample")).toMatchObject({ itemCount: 12, answerType: "numeric" });
    expect(byId.get("long_context_reasoning_sample")).toMatchObject({ itemCount: 12, answerType: "mixed" });
    expect(byId.get("swebench_style_sample")).toMatchObject({ itemCount: 10, answerType: "code", requiresCodeExecution: true });
  });
});
