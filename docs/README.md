# Soprano Lab (web demo)

The Soprano Lab demo as static files, published by GitHub Pages and also
meant to be served at `minhee.io/soprano-lab` (copied into the personal
website's `public/soprano-lab/`). It shows five soprano works with a
scrollable score, synchronized audio, and measure-range selection.

Questions are answered live by the API named in `index.html`
(`<meta name="soprano-lab-api" content="…">`): `../demo/server.py` with the
measure-aware RAG pipeline, deployed to Cloud Run with Gemini on Vertex AI
writing single-pass answers instead of the local Qwen3-14B
([`../deploy/cloudrun/`](../deploy/cloudrun/)). Each answer is labeled with
the model that wrote it.

The player links each piece's recording to its YouTube source (Sumi Jo;
`AUDIO_SOURCES` in `app.js`).

The English / 한국어 toggle in the top bar switches the page between English
and Korean: its text, the sample questions (the paper's Korean originals in
Korean) and the language the API answers in, whatever the question's
language. `?lang=en` or `?lang=ko` picks one in a link; otherwise the
visitor's last choice, or on a first visit the browser's language, decides.

Each piece has up to three sample questions about the whole piece and up to
three about a measure range, shown as two groups. They are the paper's
sample questions (`../rag/sample_questions.md`) and, to fill the groups, the
dataset's evaluation questions, each in its own wording and scope; pieces
with fewer such questions show fewer.

The page also keeps the sample questions' answers precomputed by the full
local system (Qwen3-14B), in English and in Korean. They are shown when the
meta tag is empty, or when the API is unreachable, rate-limited or out of
quota; asking a sample question with its listed range (or the whole piece)
then loads the saved response in the page's language and renders it exactly
as the live app does.

When the live API keeps records (its `/api/health` says so), a note under
the Ask button says that questions and answers are saved to improve the demo
and asks visitors not to include personal information. "Don't save my
questions" opts out; the browser remembers the choice. Each answer then has
👍 / 👎 buttons and an optional comment, sent to the API as feedback,
whether or not the question was saved. Without the live API nothing is
saved and neither is shown.

Lyrics shown beside answers are LLM-assisted transcriptions of the scores.
Expert evidence is Korean. On the English page it is shown in English
translation where the answer carries one, with the Korean original
available; three expert units in the saved answers (`in-flowery-clouds-ku-008`,
`la-capinera-ku-018`, `una-voce-poco-fa-ku-036`) have no up-to-date English
translation and are shown in Korean, as in the live app.

Paper: “Soprano Lab: Measure-Aware Question Answering over Expert
Vocal-Performance Annotations” (ISMIR 2026 Late-Breaking Demo).

This directory is published by GitHub Pages at
<https://minigb.github.io/soprano-lab/>. The repository's top-level README
describes the whole project.

## Layout

All URLs are relative, so the site works under `/soprano-lab/` or any other
path prefix.

```text
index.html, app.js, styles.css     frontend (adapted from demo/static)
api/pieces.json                    GET /api/pieces
api/pieces/<id>/score.json         GET /api/pieces/<id>/score
api/pieces/<id>/alignment.json     GET /api/pieces/<id>/alignment
media/audio/<id>.mp3               GET /media/audio/<id>.mp3
media/score/<id>/Concatenated.png  GET /media/score/<id>/Concatenated.png
answers/<piece>/<n>.json           POST /api/ask response for sample question n
answers/<piece>/<n>.ko.json        the same question asked in Korean
answers/index.json                 question, range, language and file of each saved answer
tools/export.py                    regenerates api/, media/ and answers/
.nojekyll                          only matters on GitHub Pages; harmless elsewhere
```

Changes from the live frontend are limited to `app.js` (a relative data base
path, `.json` suffixes for API GETs, asking the configured API with a
fallback to `answers/`, a tag naming the answer's model, the English/Korean
page language, and reserving each score image's size before it loads),
relative asset links, the API meta tag, the language toggle and a short note
in `index.html`, and their styles in `styles.css`.

## Regenerating

Start the live demo server with the settings used for the snapshot (it needs
the `soprano-qa` Conda environment for llama-cpp and a GPU for Qwen3-14B):

```bash
cd demo   # from the repository root
SOPRANO_QA_SETTINGS=/path/to/settings.json \
  ~/miniconda3/envs/soprano-qa/bin/python server.py --host 127.0.0.1 --port 8792
```

Then, from this directory:

```bash
python3 tools/export.py --server http://127.0.0.1:8792
```

This re-exports every GET the frontend makes and re-asks each sample question
in `EXAMPLE_QUESTIONS` (`app.js`, `language: "en"`) and `EXAMPLE_QUESTIONS_KO`
(`language: "ko"`) with the chip's range, saving the exact JSON responses.
`--skip-answers` exports data and media only; `--skip-data` re-asks only;
`--languages ko` re-asks one language and keeps the other's answers;
`--reuse` keeps the saved answer of a question whose wording and range are
unchanged and asks only the new ones; `--compare <file>` reports differences
of the English answers from another run's. Answer files no longer listed are
removed.

## Previewing locally

Serve the repository root so a path prefix (`/docs/`) is exercised:

```bash
cd ..
python3 -m http.server 8793
# open http://127.0.0.1:8793/docs/
```

`python3 -m http.server` ignores HTTP Range requests, so in this preview the
browser cannot seek the audio and clicking a measure restarts playback from
the beginning. Hosts such as Vercel and GitHub Pages serve ranges, and
seeking works there (and with any range-capable local server).
