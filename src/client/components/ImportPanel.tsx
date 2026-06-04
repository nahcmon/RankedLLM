import { Upload } from "lucide-react";
import type { FormEvent } from "react";
import { useState } from "react";
import { importBenchmark } from "../api";
import type { BenchmarkDefinition, ImportFormat } from "../types";

interface ImportPanelProps {
  onImported: (benchmarks: BenchmarkDefinition[]) => void;
}

const formats: Array<{ value: ImportFormat; label: string }> = [
  { value: "rankedllm_jsonl", label: "RankedLLM JSONL" },
  { value: "mmlu_csv", label: "MMLU CSV" },
  { value: "arc_jsonl", label: "ARC JSONL" },
  { value: "openbookqa_jsonl", label: "OpenBookQA JSONL" },
  { value: "hellaswag_jsonl", label: "HellaSwag JSONL" },
  { value: "winogrande_jsonl", label: "WinoGrande JSONL" },
  { value: "truthfulqa_csv", label: "TruthfulQA CSV" },
  { value: "gsm8k_jsonl", label: "GSM8K JSONL" },
  { value: "boolq_jsonl", label: "BoolQ JSONL" },
  { value: "piqa_jsonl", label: "PIQA JSONL + labels" },
  { value: "bbh_json", label: "BBH JSON" },
  { value: "mbpp_jsonl", label: "MBPP JSONL" }
];

export function ImportPanel({ onImported }: ImportPanelProps) {
  const [format, setFormat] = useState<ImportFormat>("rankedllm_jsonl");
  const [benchmarkId, setBenchmarkId] = useState("");
  const [benchmarkName, setBenchmarkName] = useState("");
  const [category, setCategory] = useState("");
  const [limit, setLimit] = useState("200");
  const [status, setStatus] = useState("");
  const [isImporting, setIsImporting] = useState(false);

  async function handleImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsImporting(true);
    setStatus("Importing");
    try {
      const input = event.currentTarget.elements.namedItem("files") as HTMLInputElement;
      const files = await Promise.all(
        [...(input.files ?? [])].map(async (file) => ({ name: file.name, content: await file.text() }))
      );
      const result = await importBenchmark({
        format,
        benchmarkId,
        benchmarkName,
        category: category || undefined,
        limit: Number(limit) || undefined,
        files
      });
      onImported(result.benchmarks);
      setStatus(`Imported ${result.importedCount} item(s) as ${result.benchmarkId}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <section className="panel import-panel" aria-labelledby="import-heading">
      <div className="panel__header">
        <div>
          <h2 id="import-heading">Official import</h2>
          <p>Convert local benchmark files into RankedLLM JSONL</p>
        </div>
        <Upload size={18} aria-hidden="true" />
      </div>

      <form className="import-form" onSubmit={handleImport}>
        <label className="field">
          <span>Format</span>
          <select value={format} onChange={(event) => setFormat(event.target.value as ImportFormat)}>
            {formats.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Benchmark ID</span>
          <input value={benchmarkId} onChange={(event) => setBenchmarkId(event.target.value)} placeholder="my_official_subset" />
        </label>
        <label className="field">
          <span>Benchmark name</span>
          <input value={benchmarkName} onChange={(event) => setBenchmarkName(event.target.value)} placeholder="My official subset" />
        </label>
        <label className="field">
          <span>Category</span>
          <input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Optional" />
        </label>
        <label className="field">
          <span>Limit</span>
          <input type="number" min="1" value={limit} onChange={(event) => setLimit(event.target.value)} />
        </label>
        <label className="field import-form__files">
          <span>Files</span>
          <input name="files" type="file" multiple required />
        </label>
        <button className="secondary-button" type="submit" disabled={isImporting || !benchmarkId || !benchmarkName}>
          <Upload size={15} aria-hidden="true" />
          Import
        </button>
      </form>
      {status ? <div className="import-status">{status}</div> : null}
    </section>
  );
}
