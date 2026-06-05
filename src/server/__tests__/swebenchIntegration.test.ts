import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { LmStudioClient } from "../lmStudioClient.js";
import {
  OfficialSwebenchManager,
  buildOfficialEvaluationCommand,
  buildSwebenchPrompt,
  cleanModelPatch
} from "../swebenchIntegration.js";

let tempRoot = "";
const originalOfficialSwebenchFlag = process.env.RANKEDLLM_ENABLE_OFFICIAL_SWEBENCH;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "rankedllm-swebench-"));
});

afterEach(async () => {
  if (originalOfficialSwebenchFlag === undefined) {
    delete process.env.RANKEDLLM_ENABLE_OFFICIAL_SWEBENCH;
  } else {
    process.env.RANKEDLLM_ENABLE_OFFICIAL_SWEBENCH = originalOfficialSwebenchFlag;
  }
  await rm(tempRoot, { recursive: true, force: true });
});

describe("official SWE-bench integration", () => {
  it("builds patch-only prompts and strips model prose from diffs", () => {
    const prompt = buildSwebenchPrompt({
      instance_id: "django__django-12345",
      repo: "django/django",
      base_commit: "abc123",
      problem_statement: "Fix the failing form validation."
    });

    expect(prompt).toContain("Instance ID: django__django-12345");
    expect(prompt).toContain("Return only a unified diff patch");
    expect(prompt).toContain("Fix the failing form validation.");

    expect(
      cleanModelPatch("Here is the patch:\n```diff\ndiff --git a/a.py b/a.py\n--- a/a.py\n+++ b/a.py\n@@ -1 +1 @@\n-a\n+b\n```")
    ).toBe("diff --git a/a.py b/a.py\n--- a/a.py\n+++ b/a.py\n@@ -1 +1 @@\n-a\n+b");
  });

  it("constructs upstream evaluator commands without executing them", () => {
    const swebench = buildOfficialEvaluationCommand(
      {
        suiteId: "swe_bench",
        predictionsPath: "official-runs/preds.jsonl",
        datasetName: "princeton-nlp/SWE-bench",
        split: "test",
        maxWorkers: 2,
        runId: "local-run",
        instanceIds: ["sympy__sympy-20590"],
        namespace: ""
      },
      tempRoot,
      "generated"
    );

    expect(swebench.executable).toBe("python3");
    expect(swebench.args).toEqual(
      expect.arrayContaining([
        "-m",
        "swebench.harness.run_evaluation",
        "--predictions_path",
        path.join(tempRoot, "official-runs/preds.jsonl"),
        "--instance_ids",
        "sympy__sympy-20590",
        "--namespace",
        ""
      ])
    );

    const pro = buildOfficialEvaluationCommand(
      {
        suiteId: "swe_bench_pro",
        predictionsPath: "official-runs/pro-preds.json",
        swebenchProRepoPath: "SWE-bench_Pro-os",
        rawSamplePath: "swe_bench_pro_full.csv",
        maxWorkers: 3,
        useLocalDocker: true
      },
      tempRoot,
      "pro-run"
    );
    expect(pro.args).toEqual(expect.arrayContaining(["swe_bench_pro_eval.py", "--num_workers=3", "--use_local_docker"]));
    expect(pro.cwd).toBe(path.join(tempRoot, "SWE-bench_Pro-os"));
  });

  it("generates official SWE-bench prediction JSONL with a mocked provider", async () => {
    const client = new LmStudioClient(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: "diff --git a/example.py b/example.py\n--- a/example.py\n+++ b/example.py\n@@ -1 +1 @@\n-old\n+new"
              }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const manager = new OfficialSwebenchManager(tempRoot, client);
    const runId = manager.startPredictionRun({
      suiteId: "swe_bench",
      serverBaseUrl: "http://lmstudio.test/v1",
      modelId: "lfm2.5-8b-a1b",
      source: {
        type: "inline_file",
        file: {
          name: "swe.jsonl",
          content: JSON.stringify({
            instance_id: "example__repo-1",
            repo: "example/repo",
            base_commit: "abc",
            problem_statement: "Fix it."
          })
        }
      },
      temperature: 0,
      timeoutMs: 5000
    });

    await vi.waitFor(() => expect(manager.getProgress(runId)?.status).toBe("completed"));
    const artifactPath = manager.getProgress(runId)?.artifactPath;
    expect(artifactPath).toBeTruthy();
    const rows = (await readFile(artifactPath as string, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(rows[0]).toMatchObject({
      instance_id: "example__repo-1",
      model_name_or_path: "lfm2.5-8b-a1b"
    });
    expect(rows[0].model_patch).toContain("diff --git");
  });

  it("exposes official suite metadata and refuses evaluation while disabled", async () => {
    await mkdir(path.join(tempRoot, "benchmarks"));
    await writeFile(
      path.join(tempRoot, "benchmarks", "smoke.jsonl"),
      JSON.stringify({
        id: "mock",
        benchmark_id: "smoke",
        benchmark_name: "Smoke",
        category: "smoke",
        answer_type: "string",
        prompt: "Say ok",
        expected_answer: "ok"
      }) + "\n",
      "utf8"
    );

    const { app } = await createApp({ projectRoot: tempRoot, fetchImpl: vi.fn<typeof fetch>() });
    const suitesResponse = await request(app).get("/api/official-suites");
    expect(suitesResponse.body.suites.map((suite: { id: string }) => suite.id)).toEqual(["swe_bench", "swe_bench_pro"]);
    expect(suitesResponse.body.officialSwebenchEvaluationEnabled).toBe(false);

    const evaluationResponse = await request(app).post("/api/official-suites/evaluation-runs").send({
      suiteId: "swe_bench",
      predictionsPath: "official-runs/preds.jsonl"
    });
    expect(evaluationResponse.status).toBe(400);
    expect(evaluationResponse.body.message).toContain("RANKEDLLM_ENABLE_OFFICIAL_SWEBENCH=1");
  });
});
