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

`rag/` and `demo/` are also their own repositories,
[soprano-qa-rag-system](https://github.com/minigb/soprano-qa-rag-system) and
[soprano-qa-demo](https://github.com/minigb/soprano-qa-demo), where work on
them happens first. Their full histories are kept here, and
[`tools/upstream`](#syncing-with-the-upstream-repositories) merges new commits
from them.

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

## Syncing with the upstream repositories

The `codex/refine-rag-quality` branch includes the
[October 31 security/quality comparison](rag/evaluation/quality_refinement_2026-10-31/report.md)
and its full static-export audit. The new 25-answer export is a review artifact
under `rag/evaluation/quality_refinement_2026-10-31/static-preview/`; it has not
replaced `docs/answers/`. Saved static answers do not change when Python code
changes. Future exports record their requests, response hashes and timestamps
in `docs/answers/manifest.json`, including unavailable responses.

The follow-up [meaning-fidelity audit](rag/evaluation/meaning_fidelity_2026-10-31/report.md)
found ten new material regressions, including reversed pronunciation advice
and incorrect vowel connections, despite unchanged returned evidence. The
refinement has not established meaning preservation. The [side-by-side review](rag/evaluation/meaning_fidelity_2026-10-31/review.html)
and complete [Korean](rag/evaluation/meaning_fidelity_2026-10-31/prompts/answer-ko.txt)/[English](rag/evaluation/meaning_fidelity_2026-10-31/prompts/answer-en.txt)
system prompts are saved for inspection; the running demo and static answers
have not been updated by this audit.

Commit and push to soprano-qa-rag-system or soprano-qa-demo as usual, then
bring the new commits into this repository:

```bash
tools/upstream status
```

```bash
tools/upstream pull
```

`status` lists the upstream commits not merged yet and what differs here from
the last merged upstream state; `pull` merges them (`tools/upstream pull rag`
for one directory). Each pull is a regular `git merge -Xsubtree=rag` (or
`demo`). Because the upstream histories were merged in whole, git finds the
last synced commit by itself and upstream commits keep their SHAs here, so
`git log`, `blame` and `bisect` work across both repositories. Edits that
exist only here (one more `../` in dataset paths, the README setup text) are
kept through pulls, and `status` shows them so they stay small. A conflict
means upstream changed the same lines: resolve it under that directory and run
`git commit`.

The tool adds `upstream-rag` and `upstream-demo` remotes on first use. To merge
commits that are not pushed yet, point one at a local checkout, for example
`git remote set-url upstream-rag ../soprano-qa-rag-system`.

To send a change made here back upstream, export it relative to its directory
and apply it in a checkout of that repository:

```bash
git format-patch -1 --relative=rag <commit> --stdout | git -C ../soprano-qa-rag-system am -3
```
