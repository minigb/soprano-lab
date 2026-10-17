# Soprano Lab (static snapshot)

A static copy of the Soprano Lab demo, meant to be served at
`minhee.io/soprano-lab` (copied into the personal website's
`public/soprano-lab/`). It shows five soprano works with a scrollable score,
synchronized audio, and measure-range selection, and it answers the 25 sample
questions with answers precomputed by the full system.

The full demo (`../demo/`) sends questions to a measure-aware RAG
pipeline and a local Qwen3-14B model. This snapshot runs no model: asking a
sample question with its listed range (or the whole piece) loads the saved
response and renders it exactly as the live app does. Any other question or
range shows a notice instead.

Lyrics shown beside answers are LLM-assisted transcriptions of the scores. Expert
evidence is shown in English translation, with the Korean original available;
three expert units in the saved answers (`in-flowery-clouds-ku-008`,
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
index.html, app.js, styles.css     frontend (copied from demo/static)
api/pieces.json                    GET /api/pieces
api/pieces/<id>/score.json         GET /api/pieces/<id>/score
api/pieces/<id>/alignment.json     GET /api/pieces/<id>/alignment
media/audio/<id>.mp3               GET /media/audio/<id>.mp3
media/score/<id>/Concatenated.png  GET /media/score/<id>/Concatenated.png
answers/<piece>/<n>.json           POST /api/ask response for sample question n
answers/index.json                 question, range and file of each saved answer
tools/export.py                    regenerates api/, media/ and answers/
.nojekyll                          only matters on GitHub Pages; harmless elsewhere
```

Changes from the live frontend are limited to `app.js` (a relative data base
path, `.json` suffixes for API GETs, and answering from `answers/`),
relative asset links and a short note in `index.html`, and the note's style in
`styles.css`.

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
in `EXAMPLE_QUESTIONS` (`app.js`) with `language: "en"` and the chip's range,
saving the exact JSON responses. `--skip-answers` exports data and media
only; `--skip-data` re-asks only; `--compare <file>` reports differences from
another run's answers.

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
