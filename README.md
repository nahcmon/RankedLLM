# RankedLLM

Local full-stack benchmark runner for LLMs served through LM Studio or another OpenAI-compatible LLM provider.

RankedLLM does not include its own AI model, judge, embeddings, agent, or cloud API dependency. It only connects to the LLM provider URL you configure, sends benchmark prompts, and scores responses with deterministic local rules.

## Install

```bash
npm install
```

## Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## LM Studio Setup

1. Start the LM Studio local server.
2. Load a model in LM Studio.
3. In RankedLLM, use the base URL for your LM Studio OpenAI-compatible endpoint.

Default development URL:

```text
http://192.168.111.36:1234/v1
```

The app calls:

- `GET {baseUrl}/models`
- `POST {baseUrl}/chat/completions`

When models are refreshed, RankedLLM prefers `lfm2.5-8b-a1b` when that model is available. If it is not returned, it falls back to the closest Qwen 0.8B-style model, then to the first returned model.

If LM Studio returns `Model unloaded.` during a benchmark prompt, RankedLLM makes one best-effort call to LM Studio's native `POST /api/v1/models/load` endpoint for the selected model and retries the same prompt. Other provider errors are still recorded as prompt-level errors.

## Results Storage

Prompt-level results are appended to the root-level file:

```text
results.csv
```

The backend creates the file if missing. If an existing file has the wrong header, it is backed up as `results-<timestamp>.bak.csv` and a new valid `results.csv` is created.

The CSV header is:

```text
run_id,timestamp,server_base_url,model_id,benchmark_id,benchmark_name,benchmark_category,prompt_id,prompt,choices,expected_answer,raw_output,normalized_output,is_correct,score,latency_ms,error
```

The History page is rebuilt from `results.csv` on backend startup and supports filtering by model, benchmark, date, and run ID. Use the CSV button in the History page to download the current file.

History also includes comparison charts across models for accuracy, average latency, and model/benchmark combinations.

The Dashboard shows a static preview of selected benchmark prompts before a run and a live preview of the currently executing prompt during a run.

## Benchmarks

Seed files live in `benchmarks/`:

- `smoke.jsonl`
- `mmlu_sample.jsonl`
- `arc_sample.jsonl`
- `hellaswag_sample.jsonl`
- `winogrande_sample.jsonl`
- `truthfulqa_sample.jsonl`
- `gsm8k_sample.jsonl`
- `boolq_sample.jsonl`
- `piqa_sample.jsonl`
- `openbookqa_sample.jsonl`
- `bbh_sample.jsonl`
- `mmlu_pro_hard_sample.jsonl` - 16 prompts
- `gpqa_hard_sample.jsonl` - 12 prompts
- `math_competition_sample.jsonl` - 12 prompts
- `long_context_reasoning_sample.jsonl` - 12 prompts
- `swebench_style_sample.jsonl` - 10 disabled-by-default code repair prompts
- `mbpp_sample.jsonl`

These are local benchmark subsets with locally authored representative items. They are inspired by established benchmarks, but they are not official benchmark datasets and do not produce official scores.

The quick smoke test stays small on purpose. Use the MMLU-Pro-style, GPQA-style, competition math, long-context, and SWE-bench-style groups for longer and harder local runs.

References used for adapter design:

- [LM Studio OpenAI compatibility endpoints](https://lmstudio.ai/docs/app/api/endpoints/openai)
- [LM Studio REST API](https://lmstudio.ai/docs/developer/rest)
- [MMLU repository](https://github.com/hendrycks/test)
- [AI2 ARC dataset](https://allenai.org/data/arc)
- [HellaSwag repository](https://github.com/rowanz/hellaswag)
- [WinoGrande repository](https://github.com/allenai/winogrande)
- [TruthfulQA repository](https://github.com/sylinrl/TruthfulQA)
- [GSM8K repository](https://github.com/openai/grade-school-math)
- [BoolQ repository](https://github.com/google-research-datasets/boolean-questions)
- [PIQA page](https://yonatanbisk.com/piqa/)
- [OpenBookQA dataset card](https://huggingface.co/datasets/allenai/openbookqa)
- [BIG-bench repository](https://github.com/google/BIG-bench)
- [MBPP dataset card](https://huggingface.co/datasets/google-research-datasets/mbpp)
- [MMLU-Pro paper](https://proceedings.neurips.cc/paper_files/paper/2024/file/ad236edc564f3e3156e1b2feafb99a24-Paper-Datasets_and_Benchmarks_Track.pdf)
- [GPQA repository](https://github.com/idavidrein/gpqa)
- [SWE-bench repository](https://github.com/swe-bench/SWE-bench)
- [SWE-bench datasets guide](https://www.swebench.com/SWE-bench/guides/datasets/)
- [LiveCodeBench repository](https://github.com/LiveCodeBench/LiveCodeBench)
- [IFEval code and data](https://github.com/google-research/google-research/tree/master/instruction_following_eval)

## Add a Benchmark JSONL File

Add a `.jsonl` file under `benchmarks/`. Each line must be one JSON object:

```json
{
  "id": "my_benchmark_001",
  "benchmark_id": "my_benchmark",
  "benchmark_name": "My benchmark",
  "category": "reasoning",
  "answer_type": "multiple_choice",
  "prompt": "Which option is correct?",
  "choices": [
    { "label": "A", "text": "First option" },
    { "label": "B", "text": "Second option" }
  ],
  "expected_answer": "A",
  "source": {
    "name": "Local item",
    "note": "Locally authored."
  },
  "default_max_tokens": 8
}
```

Supported `answer_type` values:

- `multiple_choice`
- `numeric`
- `string`
- `code`

Multiple-choice scoring normalizes outputs such as `A`, `A.`, `(A)`, and `Answer: A`. Numeric scoring extracts the final number and matches exactly, with tiny decimal tolerance. String scoring uses strict normalized text matching.

## Reasoning Models

Reasoning models are supported as ordinary provider models. The app does not inspect, judge, or use reasoning traces as answers.

Scoring uses only final answer content:

- Separate OpenAI-compatible fields such as `reasoning_content` are ignored for scoring.
- Inline reasoning blocks such as `<think>...</think>`, `<reasoning>...</reasoning>`, and similar tags are stripped before answer normalization.
- If a model returns reasoning but no final answer content, the row is marked with an error and the answer is scored as incorrect.
- For likely reasoning model IDs such as `lfm2.5-8b-a1b`, `deepseek-r1`, `qwen3`, or Gemma 3/4, RankedLLM raises the default `max_tokens` to 4096 when the Max tokens field is blank. If you set Max tokens manually, your value is used.

## Official-Format Import

The Dashboard includes an Official import panel. It converts local files you choose in the browser into RankedLLM JSONL under:

```text
benchmarks/imported/
```

Supported import formats:

- RankedLLM JSONL
- MMLU CSV
- ARC JSONL
- OpenBookQA JSONL
- HellaSwag JSONL
- WinoGrande JSONL
- TruthfulQA CSV
- GSM8K JSONL
- BoolQ JSONL
- PIQA JSONL plus label `.lst`
- BIG-bench/BBH JSON with `examples`
- MBPP JSONL

The app does not download benchmark datasets itself. Import is local-file only, so the only network provider connection in normal use is the configured LLM provider endpoint.

Imported full datasets still do not become official benchmark scores unless you also follow the upstream benchmark's exact split, prompt, shot count, and evaluation protocol.

## Code Benchmarks

`mbpp_sample.jsonl`, `swebench_style_sample.jsonl`, and imported MBPP files are Python code benchmarks. They are disabled by default.

To allow code tests:

```bash
RANKEDLLM_ENABLE_CODE_BENCHMARKS=1 npm run dev
```

You must also have Docker available. Even then, the UI requires a per-run opt-in. The backend runs generated Python only through `docker run` with no network, a read-only mounted temporary directory, memory/CPU/PID limits, and a strict timeout. It never executes shell commands from model output.

The SWE-bench-style bundled file is a local repair subset. A real SWE-bench or SWE-bench Lite score requires the official dataset, repository checkouts, patch application, Docker images, and the upstream evaluation harness; RankedLLM does not claim official SWE-bench scores from the bundled local tasks.

## API

- `GET /api/health`
- `POST /api/lmstudio/test-connection`
- `POST /api/lmstudio/models`
- `GET /api/benchmarks`
- `GET /api/benchmarks/items`
- `POST /api/benchmarks/import`
- `POST /api/runs`
- `GET /api/runs`
- `GET /api/runs/:runId/events`
- `GET /api/results.csv`

## Tests

```bash
npm test
```

The test suite covers answer normalization, CSV read/write and repair, benchmark loading, official-format import adapters, code execution fail-closed behavior, result aggregation, preferred model selection, and a mocked LM Studio run.

## Limitations

- Scores from the included data are local subset scores only.
- The app does not use another LLM as a judge.
- The app has no built-in AI functionality. Provider calls happen only for selected benchmark prompts.
- Code generation benchmarks require explicit server and UI opt-in and Docker.
- Results are stored in one local CSV file, not a database.
- Token usage and throughput are not reported because many local OpenAI-compatible servers omit usage metadata.
