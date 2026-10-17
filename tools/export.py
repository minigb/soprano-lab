#!/usr/bin/env python3
"""Regenerate the static Soprano Lab snapshot from a running demo server.

The script talks to a running ``soprano-qa-demo`` server (``server.py``) and
writes, relative to the site root (the parent of this ``tools/`` directory):

* ``api/pieces.json``, ``api/pieces/<id>/score.json`` and
  ``api/pieces/<id>/alignment.json``: the exact bodies of the server's GET
  endpoints;
* ``media/audio/<id>.mp3`` and ``media/score/<id>/<page>.png``: the media
  files the frontend loads;
* ``answers/<piece>/<n>.json``: the exact ``POST /api/ask`` responses for the
  sample questions listed in ``EXAMPLE_QUESTIONS`` in ``app.js`` (``n`` is the
  1-based chip position), asked with ``language: "en"`` and the chip's measure
  range (or the whole piece), plus ``answers/index.json``.

Only the standard library is used. Example:

    python3 tools/export.py --server http://127.0.0.1:8792
    python3 tools/export.py --skip-answers          # data and media only
    python3 tools/export.py --compare other_run.json  # report answer diffs
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

SITE_ROOT = Path(__file__).resolve().parents[1]
ASK_TIMEOUT_SECONDS = 1800


def fetch(server: str, path: str, data: bytes | None = None, timeout: float = 120) -> bytes:
    headers = {"Content-Type": "application/json"} if data is not None else {}
    request = urllib.request.Request(server + path, data=data, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.read()
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")
        raise SystemExit(f"{path}: HTTP {exc.code}: {body}") from exc


def write(rel_path: str, body: bytes) -> None:
    target = SITE_ROOT / rel_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(body)
    print(f"  {rel_path} ({len(body):,} bytes)")


def sample_questions(app_js: Path) -> dict[str, list[dict]]:
    """Parse EXAMPLE_QUESTIONS from app.js so the chips and answers stay in sync."""
    source = app_js.read_text(encoding="utf-8")
    block = re.search(r"const EXAMPLE_QUESTIONS = \{(.*?)\n\};", source, re.S)
    if not block:
        raise SystemExit("EXAMPLE_QUESTIONS not found in app.js")
    questions: dict[str, list[dict]] = {}
    piece = None
    for line in block.group(1).splitlines():
        line = line.strip()
        header = re.fullmatch(r'"([a-z0-9-]+)": \[', line)
        if header:
            piece = header.group(1)
            questions[piece] = []
            continue
        entry = re.fullmatch(r'\{ text: ("(?:[^"\\]|\\.)*"), range: (null|\[\d+, \d+\]) \},?', line)
        if entry:
            questions[piece].append(
                {"text": json.loads(entry.group(1)), "range": json.loads(entry.group(2))}
            )
        elif line and line not in ("],",):
            raise SystemExit(f"unparsed EXAMPLE_QUESTIONS line: {line}")
    return questions


def export_data(server: str) -> list[str]:
    print("Data and media:")
    pieces_body = fetch(server, "/api/pieces")
    write("api/pieces.json", pieces_body)
    piece_ids = [piece["id"] for piece in json.loads(pieces_body)["pieces"]]
    for piece_id in piece_ids:
        score_body = fetch(server, f"/api/pieces/{piece_id}/score")
        write(f"api/pieces/{piece_id}/score.json", score_body)
        write(
            f"api/pieces/{piece_id}/alignment.json",
            fetch(server, f"/api/pieces/{piece_id}/alignment"),
        )
        write(f"media/audio/{piece_id}.mp3", fetch(server, f"/media/audio/{piece_id}.mp3"))
        for page in json.loads(score_body)["pages"]:
            image_url = page["image_url"]
            write(image_url.lstrip("/"), fetch(server, image_url))
    return piece_ids


def export_answers(server: str) -> None:
    print("Sample-question answers (language: en):")
    index = []
    for piece_id, examples in sample_questions(SITE_ROOT / "app.js").items():
        for n, example in enumerate(examples, start=1):
            request = {
                "piece_id": piece_id,
                "question": example["text"],
                "measure_range": example["range"],
                "generate": True,
                "language": "en",
            }
            print(f"  asking {piece_id} #{n}: {example['text']}", flush=True)
            body = fetch(
                server,
                "/api/ask",
                data=json.dumps(request).encode("utf-8"),
                timeout=ASK_TIMEOUT_SECONDS,
            )
            json.loads(body)  # fail rather than save a non-JSON body
            rel_path = f"answers/{piece_id}/{n}.json"
            write(rel_path, body)
            index.append(
                {
                    "piece_id": piece_id,
                    "n": n,
                    "question": example["text"],
                    "measure_range": example["range"],
                    "language": "en",
                    "file": rel_path,
                }
            )
    payload = {"answers": index}
    write(
        "answers/index.json",
        (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
    )


def compare(reference_path: Path) -> int:
    """Compare saved answers with a list of {q_en, measure_range, answer_en, evidence_ids}."""
    reference = {
        (item["piece"], item["q_en"], tuple(item["measure_range"] or ())): item
        for item in json.loads(reference_path.read_text(encoding="utf-8"))
    }
    index = json.loads((SITE_ROOT / "answers/index.json").read_text(encoding="utf-8"))
    differences = 0
    for entry in index["answers"]:
        key = (entry["piece_id"], entry["question"], tuple(entry["measure_range"] or ()))
        saved = json.loads((SITE_ROOT / entry["file"]).read_text(encoding="utf-8"))
        ref = reference.get(key)
        label = f"{entry['piece_id']} #{entry['n']}"
        if ref is None:
            print(f"{label}: no reference entry")
            differences += 1
            continue
        problems = []
        if saved.get("answer") != ref.get("answer_en"):
            problems.append("answer text")
        if [e.get("id") for e in saved.get("evidence", [])] != ref.get("evidence_ids"):
            problems.append("evidence ids")
        if saved.get("answer_basis") != ref.get("answer_basis"):
            problems.append("answer_basis")
        if saved.get("score_context") != ref.get("score_context"):
            problems.append("score_context")
        if problems:
            differences += 1
            print(f"{label}: differs in {', '.join(problems)}")
            if "answer text" in problems:
                print(f"    saved:     {saved.get('answer')}")
                print(f"    reference: {ref.get('answer_en')}")
        else:
            print(f"{label}: identical")
    print(f"{differences} of {len(index['answers'])} answers differ")
    return differences


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--server", default="http://127.0.0.1:8792")
    parser.add_argument("--skip-data", action="store_true", help="do not re-export api/ and media/")
    parser.add_argument("--skip-answers", action="store_true", help="do not re-ask the sample questions")
    parser.add_argument("--compare", type=Path, help="reference sample-answer JSON to compare with")
    args = parser.parse_args()
    server = args.server.rstrip("/")
    if not args.skip_data:
        export_data(server)
    if not args.skip_answers:
        export_answers(server)
    if args.compare:
        compare(args.compare)


if __name__ == "__main__":
    sys.exit(main())
