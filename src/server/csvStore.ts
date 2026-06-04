import { createReadStream } from "node:fs";
import { copyFile, mkdir, open, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { RESULTS_CSV_HEADER, RESULTS_CSV_HEADER_LINE } from "./constants.js";
import type { PromptResultRow } from "./types.js";

export class CsvStore {
  private readonly csvPath: string;
  private rows: PromptResultRow[] = [];

  constructor(projectRoot: string) {
    this.csvPath = path.join(projectRoot, "results.csv");
  }

  get path(): string {
    return this.csvPath;
  }

  getRows(): PromptResultRow[] {
    return [...this.rows];
  }

  async initialize(): Promise<{ repaired: boolean; backupPath?: string }> {
    await mkdir(path.dirname(this.csvPath), { recursive: true });
    const exists = await fileExists(this.csvPath);
    if (!exists) {
      await writeFile(this.csvPath, `${RESULTS_CSV_HEADER_LINE}\n`, "utf8");
      this.rows = [];
      return { repaired: false };
    }

    const firstLine = await readFirstLine(this.csvPath);
    if (firstLine.trim() !== RESULTS_CSV_HEADER_LINE) {
      const backupPath = await this.backupMalformedCsv();
      await writeFile(this.csvPath, `${RESULTS_CSV_HEADER_LINE}\n`, "utf8");
      this.rows = [];
      return { repaired: true, backupPath };
    }

    this.rows = await this.readRows();
    return { repaired: false };
  }

  async appendRow(row: PromptResultRow): Promise<void> {
    const line = RESULTS_CSV_HEADER.map((key) => escapeCsv(row[key] ?? "")).join(",");
    const handle = await open(this.csvPath, "a");
    try {
      await handle.write(`${line}\n`);
    } finally {
      await handle.close();
    }
    this.rows.push(row);
  }

  async readRows(): Promise<PromptResultRow[]> {
    const content = await readFile(this.csvPath, "utf8");
    const records = parseCsv(content);
    if (records.length === 0) {
      return [];
    }
    const header = records[0];
    if (header.join(",") !== RESULTS_CSV_HEADER_LINE) {
      throw new Error("results.csv header is malformed");
    }
    return records.slice(1).filter((record) => record.length > 1 || record[0]).map((record) => {
      const row: Record<string, string> = {};
      RESULTS_CSV_HEADER.forEach((field, index) => {
        row[field] = record[index] ?? "";
      });
      return row as unknown as PromptResultRow;
    });
  }

  private async backupMalformedCsv(): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(path.dirname(this.csvPath), `results-${timestamp}.bak.csv`);
    try {
      await rename(this.csvPath, backupPath);
    } catch {
      await copyFile(this.csvPath, backupPath);
    }
    return backupPath;
  }
}

export function escapeCsv(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(current);
      rows.push(row);
      row = [];
      current = "";
      continue;
    }

    current += char;
  }

  if (current.length > 0 || row.length > 0) {
    row.push(current);
    rows.push(row);
  }

  return rows.filter((record) => record.length > 1 || record[0] !== "");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readFirstLine(filePath: string): Promise<string> {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of reader) {
      return line;
    }
    return "";
  } finally {
    reader.close();
    stream.destroy();
  }
}
