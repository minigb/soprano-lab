# Soprano Lab

Measure-aware question answering over expert vocal-performance annotations for
five soprano works. A singer picks a work and a range of measures, asks a
question in Korean or English, and gets an answer grounded in expert
commentary, with web and lesson-video coaching evidence labeled separately.

Paper: “Soprano Lab: Measure-Aware Question Answering over Expert
Vocal-Performance Annotations” (ISMIR 2026 Late-Breaking Demo).
Web demo: <https://minigb.github.io/soprano-lab/> (live answers written by
Gemini on Vertex AI; see [`deploy/cloudrun/`](deploy/cloudrun/)).

## Layout

| Path | What it is |
| --- | --- |
| [`soprano-qa-rag-system/`](https://github.com/minigb/soprano-qa-rag-system) | Submodule. Measure-aware retrieval and answer generation: hybrid BM25 + Qwen3-Embedding retrieval, then one answer call to a local Qwen3-14B or, with one setting, Gemini |
| [`soprano-qa-demo/`](https://github.com/minigb/soprano-qa-demo) | Submodule. The demo server and its local page: score, synchronized audio, measure selection, answers with cited evidence |
| [`docs/`](docs/) | The web demo as static files, published by GitHub Pages; asks the live API, with precomputed answers as a fallback |
| [`deploy/cloudrun/`](deploy/cloudrun/) | Builds and deploys the demo server with the RAG pipeline to Cloud Run as that live API, writing answers with Gemini on Vertex AI |

The RAG system and the demo are shared repositories, used here as git
submodules, so this repository holds no copy of their code. Work on them
happens in those repositories. The only thing the web demo does differently is
the answer model: `SOPRANO_QA_LLM_PROVIDER=vertex_gemini`, set by the deploy.

## Related repositories

| Repository | Visibility | Role |
| --- | --- | --- |
| [soprano-qa-dataset](https://github.com/minigb/soprano-qa-dataset) | private | Expert annotations and curated knowledge units, Sumi Jo's feedback, the English translation (`english/`), web evidence (`database/`, `web_coaching/`), scores, audio, alignments and per-measure lyrics |
| ISMIR26-LBD-Soprano-QA | private | Paper (synced with Overleaf) |
| soprano-lab-camera-ready | private | Poster, thumbnail and video for the camera-ready, with their build scripts |

Data flows dataset → RAG system → demo server → `docs/`.

## Setup

Clone this repository with its submodules, and the dataset beside it:

```bash
git clone --recurse-submodules https://github.com/minigb/soprano-lab.git
git clone https://github.com/minigb/soprano-qa-dataset.git
```

```text
workspace/
├── soprano-qa-dataset/
└── soprano-lab/
    ├── soprano-qa-rag-system/
    └── soprano-qa-demo/
```

Then follow [`soprano-qa-rag-system/README.md`](https://github.com/minigb/soprano-qa-rag-system#readme)
to create the shared `soprano-qa` Conda environment and download the local
models into `soprano-qa-rag-system/models/`, and
[`soprano-qa-demo/README.md`](https://github.com/minigb/soprano-qa-demo#readme)
to run the demo. Because the dataset sits one level up, point both at it:

```bash
export SOPRANO_QA_DATASET_ROOT="$PWD/../soprano-qa-dataset"      # demo media, scores, English translations
export SOPRANO_QA_RAG_DATASET_ROOT="$SOPRANO_QA_DATASET_ROOT"    # RAG corpus
```

The demo finds the RAG system as its sibling `soprano-qa-rag-system/`.

## Updating the submodules

After a change is merged in soprano-qa-rag-system or soprano-qa-demo, move
this repository to it and commit the new pointer:

```bash
git submodule update --remote soprano-qa-rag-system soprano-qa-demo
git add soprano-qa-rag-system soprano-qa-demo
git commit -m "Update the RAG system and demo submodules"
```

A deploy builds the commits that `HEAD` records, so this commit decides what
the live API runs. Their history before 2026-11-16, when this repository kept
copies under `rag/` and `demo/`, is still in its git log.

## Tests

```bash
cd soprano-qa-rag-system && conda run --no-capture-output -n soprano-qa python -m pytest
```

```bash
cd soprano-qa-demo && conda run --no-capture-output -n soprano-qa python -m pytest
```
