import { SYSTEM_PROMPT } from "./constants.js";
import type { BenchmarkChoice, BenchmarkItem } from "./types.js";

export function buildUserPrompt(item: BenchmarkItem): string {
  if (item.answer_type === "multiple_choice") {
    return [
      item.prompt,
      "",
      "Options:",
      ...(item.choices ?? []).map((choice) => `${choice.label.toUpperCase()}. ${choice.text}`),
      "",
      "Answer with only the option letter."
    ].join("\n");
  }

  if (item.answer_type === "numeric") {
    return [item.prompt, "", "Return only the final numeric answer."].join("\n");
  }

  if (item.answer_type === "code") {
    return [
      item.prompt,
      "",
      "Write Python 3 code only. Do not include Markdown fences or explanations.",
      item.code_tests?.length ? `Your code should pass these assertions:\n${item.code_tests.join("\n")}` : ""
    ].filter(Boolean).join("\n");
  }

  return [item.prompt, "", "Return only the exact answer string."].join("\n");
}

export function buildStoredPrompt(userPrompt: string): string {
  return [`[system] ${SYSTEM_PROMPT}`, "", `[user] ${userPrompt}`].join("\n");
}

export function serializeChoices(choices?: BenchmarkChoice[]): string {
  return choices?.map((choice) => `${choice.label.toUpperCase()}. ${choice.text}`).join(" | ") ?? "";
}
