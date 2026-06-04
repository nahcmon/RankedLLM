import { afterEach, describe, expect, it } from "vitest";
import { CodeBenchmarkExecutor, extractPythonCode } from "../codeExecutor.js";

const originalFlag = process.env.RANKEDLLM_ENABLE_CODE_BENCHMARKS;

afterEach(() => {
  if (originalFlag === undefined) {
    delete process.env.RANKEDLLM_ENABLE_CODE_BENCHMARKS;
  } else {
    process.env.RANKEDLLM_ENABLE_CODE_BENCHMARKS = originalFlag;
  }
});

describe("code benchmark executor", () => {
  it("extracts Python from fenced model output", () => {
    expect(extractPythonCode("```python\ndef add(a, b):\n    return a + b\n```")).toBe("def add(a, b):\n    return a + b");
  });

  it("fails closed unless server-side code execution is explicitly enabled", async () => {
    delete process.env.RANKEDLLM_ENABLE_CODE_BENCHMARKS;
    const result = await new CodeBenchmarkExecutor().runPython("def add(a, b): return a + b", ["assert add(1, 2) == 3"], 1000);

    expect(result.passed).toBe(false);
    expect(result.error).toContain("disabled");
  });
});
