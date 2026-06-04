import { Eye } from "lucide-react";
import type { PromptPreview } from "../types";

interface BenchmarkPreviewPanelProps {
  previews: PromptPreview[];
}

export function BenchmarkPreviewPanel({ previews }: BenchmarkPreviewPanelProps) {
  return (
    <section className="panel preview-panel" aria-labelledby="preview-heading">
      <div className="panel__header">
        <div>
          <h2 id="preview-heading">Test preview</h2>
          <p>First prompts from selected benchmarks</p>
        </div>
        <Eye size={18} aria-hidden="true" />
      </div>

      {previews.length === 0 ? (
        <div className="empty-state">Select benchmarks to preview prompts.</div>
      ) : (
        <div className="preview-list">
          {previews.map((preview) => (
            <article className="prompt-preview" key={`${preview.benchmarkId}-${preview.promptId}`}>
              <div className="prompt-preview__header">
                <span>{preview.benchmarkName}</span>
                <strong>{preview.promptId}</strong>
              </div>
              <pre>{preview.prompt}</pre>
              {preview.choices.length > 0 ? (
                <div className="prompt-preview__choices">
                  {preview.choices.map((choice) => (
                    <span key={choice.label}>
                      <strong>{choice.label}</strong> {choice.text}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="prompt-preview__expected">
                Expected: <strong>{preview.expectedAnswer}</strong>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
