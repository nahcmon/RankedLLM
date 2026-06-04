import type { BenchmarkItem, ScoreResult } from "./types.js";

const REASONING_TAGS = "think|thinking|reasoning|analysis|scratchpad|thought";
const REASONING_BLOCK_PATTERN = new RegExp(`<(${REASONING_TAGS})\\b[^>]*>[\\s\\S]*?<\\/\\1>`, "gi");
const TRAILING_REASONING_PATTERN = new RegExp(`<(?:${REASONING_TAGS})\\b[^>]*>[\\s\\S]*$`, "i");
const LEADING_REASONING_CLOSE_PATTERN = new RegExp(`^[\\s\\S]*<\\/(?:${REASONING_TAGS})>`, "i");

export function stripReasoningContext(rawOutput: string): string {
  return rawOutput
    .replace(REASONING_BLOCK_PATTERN, " ")
    .replace(LEADING_REASONING_CLOSE_PATTERN, " ")
    .replace(TRAILING_REASONING_PATTERN, " ")
    .trim();
}

export function normalizeMultipleChoiceAnswer(rawOutput: string): string {
  const text = rawOutput.trim();
  if (!text) {
    return "";
  }

  const explicitMatches = [
    ...matchesWithIndex(text, /(?:final\s+answer|answer|option|choice)\s*(?:is|:|-)?\s*\(?([A-J])\)?(?:\.|\b)/gi),
    ...matchesWithIndex(text, /\\boxed\{\s*([A-J])\s*\}/gi)
  ].sort((a, b) => a.index - b.index);
  const lastExplicitMatch = explicitMatches.at(-1);
  if (lastExplicitMatch) {
    return lastExplicitMatch.answer.toUpperCase();
  }

  const preferredPatterns = [
    /^\s*\(?([A-J])\)?(?:\.|\)|:|\s|$)/i,
    /(?:^|\n|\s)\(?([A-J])\)?(?:\.|\)|:)(?:\s|$)/i
  ];

  for (const pattern of preferredPatterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].toUpperCase();
    }
  }

  const fallback = text.match(/\b([A-J])\b/i);
  return fallback?.[1]?.toUpperCase() ?? "";
}

export function extractFinalNumber(rawOutput: string): string {
  const matches = rawOutput.match(/[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g);
  if (!matches?.length) {
    return "";
  }
  return matches[matches.length - 1].replace(/,/g, "");
}

export function normalizeStringAnswer(rawOutput: string): string {
  return rawOutput.trim().replace(/\s+/g, " ").toLowerCase();
}

export function scoreOutput(item: BenchmarkItem, rawOutput: string): ScoreResult {
  const scorableOutput = stripReasoningContext(rawOutput);
  const expected = item.expected_answer.trim();

  if (item.answer_type === "multiple_choice") {
    const normalizedOutput = normalizeMultipleChoiceAnswer(scorableOutput);
    const normalizedExpected = normalizeMultipleChoiceAnswer(expected) || expected.toUpperCase();
    const isCorrect = normalizedOutput === normalizedExpected;
    return { normalizedOutput, isCorrect, score: isCorrect ? 1 : 0 };
  }

  if (item.answer_type === "numeric") {
    const normalizedOutput = extractFinalNumber(scorableOutput);
    const normalizedExpected = extractFinalNumber(expected) || expected.replace(/,/g, "");
    const outputNumber = Number(normalizedOutput);
    const expectedNumber = Number(normalizedExpected);
    const bothNumeric = Number.isFinite(outputNumber) && Number.isFinite(expectedNumber);
    const isCorrect = bothNumeric
      ? Math.abs(outputNumber - expectedNumber) <= 1e-9
      : normalizedOutput === normalizedExpected;
    return { normalizedOutput, isCorrect, score: isCorrect ? 1 : 0 };
  }

  const normalizedOutput = normalizeStringAnswer(scorableOutput);
  const normalizedExpected = normalizeStringAnswer(expected);
  const isCorrect = normalizedOutput === normalizedExpected;
  return { normalizedOutput, isCorrect, score: isCorrect ? 1 : 0 };
}

function matchesWithIndex(text: string, pattern: RegExp): Array<{ answer: string; index: number }> {
  return [...text.matchAll(pattern)]
    .filter((match) => match[1])
    .map((match) => ({ answer: match[1], index: match.index ?? 0 }));
}
