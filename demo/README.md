# Soprano Lab

Soprano Lab is a local web demo for exploring five soprano works. It pairs
audio with a scrollable score, supports measure-range selection, and sends
questions to the measure-aware Soprano QA RAG and local-LLM pipeline.

This directory (`demo/` in the soprano-lab repository) contains the web
application. It reads media and score data from `soprano-qa-dataset`, cloned
beside soprano-lab, and imports the question-answering service from `../rag/`
at runtime.

Answers show their cited evidence and source notices. When the corpus has no
answer, any model-only response is labeled as internal knowledge.

Questions may be asked in English or Korean. `POST /api/ask` accepts an
optional `language` (`"ko"` or `"en"`); when it is omitted, the server infers
it from the question (Hangul present → `"ko"`, otherwise `"en"`). The value is
passed to the pipeline only when its `ask()` accepts a `language` parameter,
and the response reports `language`, `requested_language`, and
`language_supported`. For selected-range questions, pipelines that return
`score_context` have the selected bars' model-transcribed lyrics shown beside
the answer; web and lesson-video coaching evidence is labeled as not
expert-curated.

## Requirements

Keep the dataset beside soprano-lab with its default name:

```bash
mkdir soprano-qa-workspace
cd soprano-qa-workspace
git clone https://github.com/minigb/soprano-qa-dataset.git
git clone https://github.com/minigb/soprano-lab.git
```

```text
soprano-qa-workspace/
├── soprano-qa-dataset/
└── soprano-lab/
    ├── rag/      this RAG system
    ├── demo/     the live web demo
    └── docs/     the static snapshot (GitHub Pages)
```

Create the shared Conda environment from the dataset repository, then install
the RAG dependencies:

```bash
cd soprano-qa-dataset
conda env create -f environment.yml
conda activate soprano-qa

cd ../soprano-lab/rag
python -m pip install -r requirements.txt
python scripts/build_corpus.py
```

If the environment already exists, replace `conda env create` with:

```bash
conda env update -n soprano-qa -f environment.yml
```

Generated answers require the optional local model:

```bash
python scripts/download_model.py
```

Without the model, the demo remains usable and returns corpus-backed
extractive answers. See the
[RAG system README](../rag/README.md) for
platform-specific model installation and pipeline usage.

## Run

From `rag/`, launch the server with the shared environment explicitly so
that local LLM support is available:

```bash
cd ../demo
conda run --no-capture-output -n soprano-qa \
  python server.py --host 127.0.0.1 --port 8765
```

Open <http://127.0.0.1:8765/> and keep the server terminal running.

The header's **460개 답변 비교** link opens the saved evaluation browser at
<http://127.0.0.1:8765/static/answer-review/index.html>. It compares all 460
questions and 920 full answers from the original system and E37, with piece,
source and quality filters, Claude judgments, full KU evidence, and local notes.
It uses saved answers and does not call the model. Bookmarks and notes stay in
that browser's localStorage and can be exported as JSON.

The comparison can also run independently, without the dataset or local model:

```bash
python -m http.server 8766 --bind 127.0.0.1 --directory static/answer-review
```

Open <http://localhost:8766/>. Notes are scoped to the browser and origin, so use
the same hostname and port to return to existing notes.

Restart the server after changing demo or RAG Python code, settings, or model
configuration. Dataset evidence changes are detected and reloaded
automatically.

## Test

From `demo/`:

```bash
conda run --no-capture-output -n soprano-qa \
  python -m unittest discover -v
```

## Configuration

The default layout works without environment variables. Custom layouts can
override these paths:

| Variable | Purpose |
| --- | --- |
| `SOPRANO_QA_PIPELINE_ROOT` | RAG system directory (default `../rag`) |
| `SOPRANO_QA_DATASET_ROOT` | Dataset used for demo media and score assets |
| `SOPRANO_QA_RAG_DATASET_ROOT` | Dataset used to build the RAG corpus |
| `SOPRANO_QA_MODEL_PATH` | Local GGUF model checkpoint |

When overriding the dataset location, point both dataset variables at the same
checkout. Additional pipeline settings belong to `../rag/`;
dataset and score tooling belong to
[soprano-qa-dataset](https://github.com/minigb/soprano-qa-dataset).
