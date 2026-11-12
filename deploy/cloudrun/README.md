# Live API on Cloud Run

The web page in [`docs/`](../../docs/) (GitHub Pages,
<https://minigb.github.io/soprano-lab/>) answers free-form questions by
calling this API: [`demo/server.py`](../../demo/server.py) with the
measure-aware RAG pipeline from
[soprano-qa-rag-system](https://github.com/minigb/soprano-qa-rag-system)
and its web settings, `config/settings.web.json`.

Retrieval runs as in the paper: BM25 plus Qwen3-Embedding-0.6B, on CPU here.
Gemini on Vertex AI then writes the answer in a single pass (the
`single_pass` pipeline with `answer_provider: vertex_gemini`). The web
settings equal `settings.gemini.json` except that English questions are also
translated to Korean for retrieval by Gemini (`query_translation_provider`),
because the host has no local Qwen3-14B. The page sends its language
(English or Korean) as the answer language; a question without Hangul is
translated for retrieval in either case.

```text
browser ── GitHub Pages: page, score images, audio, saved answers (docs/)
   └────── Cloud Run: POST /api/ask ── retrieval (CPU) ── Vertex AI Gemini
```

When the API is unreachable, rate-limited or failing, the page falls back to
the precomputed Qwen3-14B answers for the sample questions.

## What the image contains

`deploy.sh` assembles the build context from:

- `demo/` of this repository at git `HEAD`;
- the RAG repository at `RAG_REF` (`soprano_qa/`, `config/`, `data/`,
  `scripts/` and the requirements; no evaluations or tests);
- the dataset checkout beside this repository (`DATASET_PATHS` in the script:
  expert reviews, web-coaching records, Sumi Jo feedback, English
  translations, lyrics, score geometry, alignments; about 23 MB).

The image stays private in Artifact Registry. The API does not serve these
files, but its answers quote evidence, as the static page does.

During the build, [`prepare_image.py`](prepare_image.py) checks that the
dataset is the revision the committed corpus was built from, rebuilds the
corpus for the image's path, and embeds it (about 7 minutes on 8 vCPUs), so
instances start with a filled embedding cache.

## Deploy

Requirements: billing enabled on the Google Cloud project and `gcloud`
logged in to it, here through `~/gemini-vertex/env.sh`.

```bash
source ~/gemini-vertex/env.sh
deploy/cloudrun/deploy.sh
```

On first use the script enables the APIs it needs and creates the Artifact
Registry repository. It also creates a `soprano-lab-api` service account that
may only call Vertex AI models (`roles/aiplatform.user`). The service runs as
that account, so no API key exists anywhere. The script then builds with
Cloud Build, deploys the service, and writes its URL into `docs/index.html`
(`<meta name="soprano-lab-api">`). Commit and push that change to publish it.

Settings (environment variables of `deploy.sh`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `RAG_REPO` | `../soprano-qa-rag-system` | RAG repository to build from |
| `RAG_REF` | `web-demo-gemini` | its branch or commit |
| `DATASET_REF` | `HEAD` | dataset revision to bundle |
| `ALLOWED_ORIGINS` | `https://minigb.github.io` | CORS origins of the page |
| `ASK_LIMIT` | `6/600` | questions per visitor per 600 s |
| `DAILY_ASK_LIMIT` | `200` | questions per rolling 24 h, all visitors |
| `REGION` | `us-central1` | Cloud Run and Artifact Registry region |
| `BUILD_MACHINE` | `e2-highcpu-8` | Cloud Build machine type |

`--context-only` only assembles the build context (`CONTEXT_DIR`) for
inspection.

The service runs with at most one instance (2 vCPU, 4 GiB), scales to zero
when idle, and is woken by the page's `/api/health` call. A new instance
listens at once and loads the embedding model and index in the background
(`SOPRANO_LAB_WARMUP=1`; about a minute on Cloud Run). The wake-up call waits
for that load, which keeps the instance's CPU on, so it usually finishes
before the visitor's first question; a question that arrives earlier waits
for it. (Loading before listening made Cloud Run drop the early requests.)
Each question
makes one Gemini call, plus one translation call for questions in English.

## Cost

Measured on the RAG evaluation's Gemini 3.8 Flash calls: about 2,000 input
and 115 output tokens per answer, so roughly $2–3 per 1,000 questions at
published Vertex prices (late 2026). Cloud Run's monthly free tier covers a
few thousand questions; Artifact Registry storage is cents per month; each
deploy's build costs about $0.20. `DAILY_ASK_LIMIT` bounds the worst case.

## Previewing before a deploy

A deploy takes about 15 minutes, so try changes locally first:

```bash
deploy/cloudrun/preview.sh
```

This serves the page from the working tree's `docs/` at
<http://127.0.0.1:8797/>, with the same API in the same process: the request
handler of `demo/server.py`, with the RAG worktree
`../soprano-qa-rag-system-web` and its web settings, answering with Gemini on
Vertex AI. [`preview.py`](preview.py) points the page's API meta tag at that
same origin and hands `/api/health` and `/api/ask` to the API's handler. It
opens no other port. (`demo/server.py` run on its own serves its older page,
`demo/static`, which has no language toggle.) Uncommitted changes in `docs/`,
`demo/` and the RAG worktree all show; the script notes when the worktree
differs from `RAG_REF`, which is what a deploy builds. Ctrl-C stops it.
`PORT`, `RAG_ROOT` and `PYTHON` override the defaults.

To open the preview on another computer, forward the port over SSH
(`ssh -L 8797:127.0.0.1:8797 <host>`), or let VS Code Remote-SSH forward it.
Then open <http://127.0.0.1:8797/> there. Questions are real Vertex AI calls,
with no question limits.
