import { describe, expect, it } from "vitest";
import { convertImportToItems } from "../officialImporters.js";
import type { BenchmarkImportRequest, ImportFormat } from "../types.js";

describe("official benchmark import adapters", () => {
  it("converts BoolQ JSONL into deterministic yes/no multiple choice items", () => {
    const items = convertImportToItems(
      request("boolq_jsonl", [
        {
          name: "dev.jsonl",
          content: JSON.stringify({
            question: "is mercury a metal",
            passage: "Mercury is a chemical element and is liquid at room temperature.",
            answer: true,
            title: "Mercury"
          })
        }
      ])
    );

    expect(items[0]).toMatchObject({
      answer_type: "multiple_choice",
      expected_answer: "A",
      choices: [
        { label: "A", text: "Yes" },
        { label: "B", text: "No" }
      ]
    });
  });

  it("converts PIQA data plus labels into two-choice items", () => {
    const items = convertImportToItems(
      request("piqa_jsonl", [
        {
          name: "valid.jsonl",
          content: JSON.stringify({ goal: "clean a dusty shelf", sol1: "wipe it with a cloth", sol2: "paint the wall" })
        },
        { name: "valid-labels.lst", content: "0\n" }
      ])
    );

    expect(items[0]).toMatchObject({
      prompt: "clean a dusty shelf",
      expected_answer: "A",
      choices: [
        { label: "A", text: "wipe it with a cloth" },
        { label: "B", text: "paint the wall" }
      ]
    });
  });

  it("converts BIG-bench JSON examples into exact-answer items", () => {
    const items = convertImportToItems(
      request("bbh_json", [
        {
          name: "boolean_expressions.json",
          content: JSON.stringify({ examples: [{ input: "not true is", target: "False" }] })
        }
      ])
    );

    expect(items[0]).toMatchObject({
      answer_type: "string",
      prompt: "not true is",
      expected_answer: "False"
    });
  });

  it("converts MBPP JSONL into disabled-by-default Python code items", () => {
    const items = convertImportToItems(
      request("mbpp_jsonl", [
        {
          name: "mbpp.jsonl",
          content: JSON.stringify({
            task_id: 602,
            text: "Write a python function to return the first repeated character.",
            test_list: ['assert first_repeated_char("abcabc") == "a"']
          })
        }
      ])
    );

    expect(items[0]).toMatchObject({
      id: "mbpp_602",
      answer_type: "code",
      code_language: "python",
      code_tests: ['assert first_repeated_char("abcabc") == "a"']
    });
  });
});

function request(format: ImportFormat, files: BenchmarkImportRequest["files"]): BenchmarkImportRequest {
  return {
    format,
    benchmarkId: "imported_subset",
    benchmarkName: "Imported subset",
    files
  };
}
