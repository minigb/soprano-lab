# Live API on Cloud Run

The web page in [`docs/`](../../docs/) (GitHub Pages,
<https://minigb.github.io/soprano-lab/>) answers free-form questions by
calling this API: the server of
[soprano-qa-demo](https://github.com/minigb/soprano-qa-demo) with the
measure-aware RAG pipeline of
[soprano-qa-rag-system](https://github.com/minigb/soprano-qa-rag-system), both
this repository's submodules.

The API runs the RAG system's default configuration with one change: the
answer model is Gemini on Vertex AI (`SOPRANO_QA_LLM_PROVIDER=vertex_gemini`,
set in the [Dockerfile](Dockerfile)), because the host has no GPU for the local
Qwen3-14B. Retrieval runs as in the paper, BM25 plus Qwen3-Embedding-0.6B on
CPU, and Gemini writes the answer in a single pass. English questions are
translated to Korean for retrieval by the same model. The page sends its
language (English or Korean) as the answer language; a question without Hangul
is translated for retrieval in either case.

```text
browser ── GitHub Pages: page, score images, audio, saved answers (docs/)
   └────── Cloud Run: POST /api/ask ── retrieval (CPU) ── Vertex AI Gemini
```

When the API is unreachable, rate-limited or failing, the page falls back to
the precomputed Qwen3-14B answers for the sample questions.

## What the image contains

`deploy.sh` assembles the build context from:

- the demo server at `DEMO_REF` (`backend/`, `server.py`, `static/`; no tests);
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
| `RAG_REPO` | `soprano-qa-rag-system` | RAG repository to build from |
| `RAG_REF` | commit recorded at `HEAD` | its commit; by default the submodule commit this repository's `HEAD` records |
| `DEMO_REPO` | `soprano-qa-demo` | demo repository to build from |
| `DEMO_REF` | commit recorded at `HEAD` | its commit, in the same way |
| `DATASET_REF` | `HEAD` | dataset revision to bundle |
| `ALLOWED_ORIGINS` | `https://minigb.github.io` | CORS origins of the page |
| `ASK_LIMIT` | `6/600` | questions per visitor per 600 s |
| `DAILY_ASK_LIMIT` | `200` | questions per rolling 24 h, all visitors |
| `REGION` | `us-central1` | Cloud Run and Artifact Registry region |
| `BUILD_MACHINE` | `e2-highcpu-8` | Cloud Build machine type |
| `RECORDS` | `1` | keep saved questions and feedback (`0`: none) |
| `RECORDS_BUCKET` | `soprano-lab-records` | log bucket and sink that keep them |
| `RECORDS_RETENTION_DAYS` | `3650` | how long the bucket keeps them |

`--context-only` only assembles the build context (`CONTEXT_DIR`) for
inspection.

The service runs with at most one instance (2 vCPU, 4 GiB) and no minimum
instance, so an idle instance costs nothing; `keep_warm.sh` keeps it from
going cold (see below). A cold service is woken by the page's `/api/health`
call. A new instance
listens at once and loads the embedding model and index in the background
(`SOPRANO_LAB_WARMUP=1`; about a minute on Cloud Run). The wake-up call waits
for that load, which keeps the instance's CPU on, so it usually finishes
before the visitor's first question; a question that arrives earlier waits
for it. (Loading before listening made Cloud Run drop the early requests.)
Each question
makes one Gemini call, plus one translation call for questions in English.

## Keeping the instance warm

A cold start takes 75–90 s, so a visitor who asks right away waits that long.
Cloud Run keeps an idle instance for up to 15 minutes after its last request
and does not bill it, so a Cloud Scheduler job that calls `/api/health` every
five minutes keeps the instance, with its index loaded, almost always ready.
It is not a guarantee: when Cloud Run does replace the instance, the next
call loads the new one. A minimum instance would guarantee it, but bills the
idle instance, about $39 a month at 2 vCPU and 4 GiB.

```bash
source ~/gemini-vertex/env.sh
deploy/cloudrun/keep_warm.sh            # create or update the job, once
deploy/cloudrun/keep_warm.sh --delete   # remove it
```

The job targets the service URL, so it survives redeploys. `KEEP_WARM_SCHEDULE`
changes its cron schedule, in UTC.

## Saved questions and feedback

The page says, under its Ask button, that questions and answers are saved to
improve the demo, and offers "Don't save my questions". Unless a visitor ticks
it, each live answer is recorded with its question, piece, measure range,
page language, the model, the answer, its basis and the cited evidence ids.
The 👍 / 👎 buttons and comment box under each answer record feedback on it.
No IP address, browser or other identifier is recorded; the per-visitor limits
keep addresses in memory only.

The service prints each record as one JSON line, which Cloud Run stores as a
structured Cloud Logging entry (`jsonPayload`, `event` is
`soprano_lab_question` or `soprano_lab_feedback`). `deploy.sh` creates a log
bucket (`RECORDS_BUCKET`, kept `RECORDS_RETENTION_DAYS`, by default the
10-year maximum) and a sink that copies these entries there; the `_Default`
bucket keeps its copy 30 days. A feedback entry's `question_record_id` is the
`record_id` of the question it rates. To download them:

```bash
source ~/gemini-vertex/env.sh
deploy/cloudrun/records.sh > records.jsonl      # DAYS=7 for the last week
```

`RECORDS=0 deploy/cloudrun/deploy.sh` deploys without records; the page then
shows neither the note nor the feedback buttons.

## Cost

Measured on the RAG evaluation's Gemini 3.8 Flash calls: about 2,000 input
and 115 output tokens per answer, so roughly $2–3 per 1,000 questions at
published Vertex prices (late 2026). Cloud Run's monthly free tier covers a
few thousand questions; Artifact Registry storage is cents per month; each
deploy's build costs about $0.20. The keep-warm job is free: Cloud Scheduler
gives each billing account three jobs a month, then $0.10 per job, and its
pings fall within Cloud Run's free tier. `DAILY_ASK_LIMIT` bounds the worst case.

## Previewing before a deploy

A deploy takes about 15 minutes, so try changes locally first:

```bash
deploy/cloudrun/preview.sh
```

This serves the page from the working tree's `docs/` at
<http://127.0.0.1:8797/>, with the same API in the same process: the request
handler of `soprano-qa-demo/server.py` with the `soprano-qa-rag-system`
submodule, answering with Gemini on Vertex AI. The dataset is read from
`../soprano-qa-dataset`. [`preview.py`](preview.py) points the page's API meta
tag at that same origin and hands `/api/health` and `/api/ask` to the API's
handler. It opens no other port. (The demo server run on its own serves its
own page, `soprano-qa-demo/static`, which has no language toggle.) Uncommitted
changes in `docs/` and in both submodules all show; the script notes when a
submodule differs from the commit `HEAD` records, which is what a deploy
builds. Ctrl-C stops it. `PORT`, `RAG_ROOT`, `DATASET_ROOT` and `PYTHON`
override the defaults.

The retrieval model must be in `soprano-qa-rag-system/models/`, where the RAG
system's own setup puts it (`python scripts/download_embedding_model.py`);
git ignores it there.

To open the preview on another computer, forward the port over SSH
(`ssh -L 8797:127.0.0.1:8797 <host>`), or let VS Code Remote-SSH forward it.
Then open <http://127.0.0.1:8797/> there. Questions are real Vertex AI calls,
with no question limits. Saved questions and feedback are printed in the
preview's terminal, one JSON line each, instead of going to Cloud Logging.
