# Soprano Lab

Measure-aware question answering over expert vocal-performance annotations for
five soprano works. A singer picks a work and a range of measures, asks a
question in Korean or English, and gets an answer grounded in expert
commentary, with web and lesson-video coaching evidence labeled separately.

Paper: “Soprano Lab: Measure-Aware Question Answering over Expert
Vocal-Performance Annotations” (ISMIR 2026 Late-Breaking Demo).
Static demo: <https://minigb.github.io/soprano-lab/>.

## Layout

| Directory | What it is |
| --- | --- |
| [`rag/`](rag/) | Measure-aware retrieval and answer generation: hybrid BM25 + Qwen3-Embedding retrieval and a local Qwen3-14B answer model |
| [`demo/`](demo/) | Live web demo: score, synchronized audio, measure selection, answers with cited evidence |
| [`docs/`](docs/) | Static snapshot of the demo with precomputed answers, published by GitHub Pages |

`rag/` and `demo/` were separate repositories (`soprano-qa-rag-system` and
`soprano-qa-demo`, now archived); their full histories are kept here.

## Related repositories

| Repository | Visibility | Role |
| --- | --- | --- |
| [soprano-qa-dataset](https://github.com/minigb/soprano-qa-dataset) | private | Expert annotations and curated knowledge units, the English translation (`english/`), web evidence (`database/`, `web_coaching/`), scores, audio, alignments and per-measure lyrics |
| ISMIR26-LBD-Soprano-QA | private | Paper (synced with Overleaf) |
| soprano-lab-camera-ready | private | Poster, thumbnail and video for the camera-ready, with their build scripts |

Data flows dataset → `rag/` → `demo/` → `docs/`.

## Setup

Clone the dataset beside this repository:

```text
workspace/
├── soprano-qa-dataset/
└── soprano-lab/
```

Then follow [`rag/README.md`](rag/README.md) to create the shared
`soprano-qa` Conda environment and download the local models, and
[`demo/README.md`](demo/README.md) to run the demo.

Other layouts work through environment variables: `SOPRANO_QA_PIPELINE_ROOT`
(the RAG system, default `rag/`), `SOPRANO_QA_DATASET_ROOT` (dataset for the
demo's media, scores and English translations) and
`SOPRANO_QA_RAG_DATASET_ROOT` (dataset for the RAG corpus). Set both dataset
variables when moving the dataset; the RAG service ignores
`SOPRANO_QA_DATASET_ROOT`.

## Tests

```bash
cd rag && conda run --no-capture-output -n soprano-qa python -m unittest discover -s tests -t .
```

```bash
cd demo && conda run --no-capture-output -n soprano-qa python -m unittest discover -s tests -t .
```
