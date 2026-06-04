import { describe, expect, it } from "vitest";
import { extractFinalNumber, normalizeMultipleChoiceAnswer, scoreOutput, stripReasoningContext } from "../scoring.js";
import type { BenchmarkItem } from "../types.js";

describe("scoring", () => {
  it("normalizes multiple-choice answers", () => {
    expect(normalizeMultipleChoiceAnswer("A")).toBe("A");
    expect(normalizeMultipleChoiceAnswer("A.")).toBe("A");
    expect(normalizeMultipleChoiceAnswer("(B)")).toBe("B");
    expect(normalizeMultipleChoiceAnswer("Answer: C")).toBe("C");
    expect(normalizeMultipleChoiceAnswer("The answer is D because...")).toBe("D");
  });

  it("extracts the final numeric answer", () => {
    expect(extractFinalNumber("The answer is 1,234.")).toBe("1234");
    expect(extractFinalNumber("First 10, then 2.5")).toBe("2.5");
  });

  it("strips reasoning traces before answer extraction", () => {
    expect(stripReasoningContext("<think>Answer: A</think>\nB")).toBe("B");
    expect(normalizeMultipleChoiceAnswer(stripReasoningContext("<think>Answer: A</think>\nB"))).toBe("B");
    expect(extractFinalNumber(stripReasoningContext("<reasoning>99</reasoning>\n42"))).toBe("42");
  });

  it("does not score answers that appear only inside reasoning context", () => {
    const item: BenchmarkItem = {
      id: "mc1",
      benchmark_id: "reasoning",
      benchmark_name: "Reasoning",
      category: "reasoning",
      answer_type: "multiple_choice",
      prompt: "Pick A",
      choices: [
        { label: "A", text: "Correct" },
        { label: "B", text: "Wrong" }
      ],
      expected_answer: "A"
    };

    expect(scoreOutput(item, "<think>Answer: A</think>")).toMatchObject({
      normalizedOutput: "",
      isCorrect: false,
      score: 0
    });
  });

  it("scores numeric and string items deterministically", () => {
    const numericItem: BenchmarkItem = {
      id: "n1",
      benchmark_id: "math",
      benchmark_name: "Math",
      category: "math",
      answer_type: "numeric",
      prompt: "x",
      expected_answer: "42"
    };
    expect(scoreOutput(numericItem, "Final answer: 42.")).toMatchObject({ isCorrect: true, score: 1 });

    const stringItem: BenchmarkItem = {
      ...numericItem,
      answer_type: "string",
      expected_answer: "ready"
    };
    expect(scoreOutput(stringItem, " READY ")).toMatchObject({ normalizedOutput: "ready", isCorrect: true });
  });
});
