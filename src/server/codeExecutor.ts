import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface CodeExecutionResult {
  passed: boolean;
  output: string;
  error: string;
}

export class CodeBenchmarkExecutor {
  isEnabled(): boolean {
    return process.env.RANKEDLLM_ENABLE_CODE_BENCHMARKS === "1";
  }

  async runPython(rawOutput: string, tests: string[], timeoutMs: number): Promise<CodeExecutionResult> {
    if (!this.isEnabled()) {
      return {
        passed: false,
        output: "",
        error: "Code benchmark execution is disabled. Start with RANKEDLLM_ENABLE_CODE_BENCHMARKS=1 and Docker available to enable it."
      };
    }
    if (tests.length === 0) {
      return { passed: false, output: "", error: "Code benchmark item has no tests." };
    }

    const tempDir = await mkdtemp(path.join(os.tmpdir(), "rankedllm-code-"));
    try {
      const code = extractPythonCode(rawOutput);
      const testFile = [
        code,
        "",
        "if __name__ == '__main__':",
        ...tests.map((test) => `    ${test}`),
        "    print('PASS')"
      ].join("\n");
      await writeFile(path.join(tempDir, "test_solution.py"), testFile, "utf8");

      const result = await execFileAsync(
        "docker",
        [
          "run",
          "--rm",
          "--network",
          "none",
          "--cpus",
          "1",
          "--memory",
          "128m",
          "--pids-limit",
          "64",
          "--read-only",
          "--tmpfs",
          "/tmp:rw,noexec,nosuid,size=16m",
          "-e",
          "PYTHONDONTWRITEBYTECODE=1",
          "-v",
          `${tempDir}:/workspace:ro`,
          "-w",
          "/workspace",
          "python:3.12-alpine",
          "python",
          "/workspace/test_solution.py"
        ],
        Math.min(Math.max(timeoutMs, 1000), 10000)
      );
      return {
        passed: result.exitCode === 0,
        output: result.stdout.trim(),
        error: result.exitCode === 0 ? "" : (result.stderr || result.stdout).trim()
      };
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}

export function extractPythonCode(rawOutput: string): string {
  const fenced = rawOutput.match(/```(?:python)?\s*([\s\S]*?)```/i);
  return (fenced?.[1] ?? rawOutput).trim();
}

function execFileAsync(
  file: string,
  args: string[],
  timeoutMs: number
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      const errorCode = (error as { code?: unknown } | null)?.code;
      const exitCode =
        typeof errorCode === "number"
          ? errorCode
          : error
            ? 1
            : 0;
      resolve({ stdout, stderr, exitCode });
    });
  });
}
