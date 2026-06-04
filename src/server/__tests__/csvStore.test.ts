import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RESULTS_CSV_HEADER_LINE } from "../constants.js";
import { CsvStore, parseCsv } from "../csvStore.js";
import type { PromptResultRow } from "../types.js";

let tempRoot = "";

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "rankedllm-csv-"));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe("CsvStore", () => {
  it("creates missing results.csv and appends escaped rows", async () => {
    const store = new CsvStore(tempRoot);
    const status = await store.initialize();
    expect(status.repaired).toBe(false);

    await store.appendRow(rowFactory({ prompt: "Line one\nLine two", raw_output: "A, quoted \"value\"" }));
    const rows = await store.readRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].prompt).toBe("Line one\nLine two");
    expect(rows[0].raw_output).toBe("A, quoted \"value\"");
  });

  it("backs up malformed CSV files and recreates the expected header", async () => {
    await writeFile(path.join(tempRoot, "results.csv"), "bad,header\nx,y\n", "utf8");
    const store = new CsvStore(tempRoot);
    const status = await store.initialize();
    expect(status.repaired).toBe(true);
    const files = await readdir(tempRoot);
    expect(files.some((file) => file.endsWith(".bak.csv"))).toBe(true);
    expect(parseCsv(await readResults(tempRoot))[0].join(",")).toBe(RESULTS_CSV_HEADER_LINE);
  });
});

async function readResults(root: string): Promise<string> {
  return import("node:fs/promises").then(({ readFile }) => readFile(path.join(root, "results.csv"), "utf8"));
}

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
    choices: "A. one | B. two",
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
