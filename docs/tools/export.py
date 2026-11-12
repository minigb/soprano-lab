#!/usr/bin/env python3
"""Regenerate the static Soprano Lab snapshot from a running demo server.

The script talks to a running demo server (``demo/server.py``) and
writes, relative to the site root (the parent of this ``tools/`` directory):

* ``api/pieces.json``, ``api/pieces/<id>/score.json`` and
  ``api/pieces/<id>/alignment.json``: the exact bodies of the server's GET
  endpoints;
* ``media/audio/<id>.mp3`` and ``media/score/<id>/<page>.png``: the media
  files the frontend loads;
* ``answers/<piece>/<n>.json`` and ``answers/<piece>/<n>.ko.json``: the
  ``POST /api/ask`` responses (absolute local file paths reduced to file
  names) for the sample questions listed in ``EXAMPLE_QUESTIONS`` (English,
  asked with ``language: "en"``) and ``EXAMPLE_QUESTIONS_KO`` (Korean,
  ``language: "ko"``) in ``app.js``, with the chip's measure range (or the
  whole piece); ``n`` is the 1-based position in the piece's list.
  ``answers/index.json`` lists them; exporting one language keeps the
  other's entries. With ``--reuse``, a question whose piece, wording, range
  and language already have a saved answer keeps it, and only the rest are
  asked. Answer files the new index no longer lists are removed.

Only the standard library is used. Example:

    python3 tools/export.py --server http://127.0.0.1:8792
    python3 tools/export.py --skip-answers          # data and media only
    python3 tools/export.py --skip-data --languages ko  # Korean answers only
    python3 tools/export.py --skip-data --reuse       # ask new samples only
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


# Sample-question list in app.js for each answer language.
QUESTION_LISTS = {"en": "EXAMPLE_QUESTIONS", "ko": "EXAMPLE_QUESTIONS_KO"}


def sample_questions(app_js: Path, language: str = "en") -> dict[str, list[dict]]:
    """Parse a sample-question list from app.js so the chips and answers stay in sync."""
    source = app_js.read_text(encoding="utf-8")
    name = QUESTION_LISTS[language]
    block = re.search(r"const %s = \{(.*?)\n\};" % name, source, re.S)
    if not block:
        raise SystemExit(f"{name} not found in app.js")
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
            raise SystemExit(f"unparsed {name} line: {line}")
    return questions


def strip_local_paths(value):
    """Reduce absolute local file paths (e.g. model files) to their file names.

    The responses are otherwise saved exactly; this only keeps the author's
    directory layout out of the public site.
    """
    if isinstance(value, dict):
        return {key: strip_local_paths(item) for key, item in value.items()}
    if isinstance(value, list):
        return [strip_local_paths(item) for item in value]
    if isinstance(value, str) and value.startswith("/") and "/" in value[1:]:
        return Path(value).name
    return value


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


def answer_key(piece_id: str, question: str, measure_range, language: str) -> tuple:
    return (piece_id, question, tuple(measure_range or ()), language)


def export_answers(server: str, languages: list[str], reuse: bool = False) -> None:
    index_path = SITE_ROOT / "answers/index.json"
    old_index = []
    if index_path.exists():
        old_index = json.loads(index_path.read_text(encoding="utf-8"))["answers"]
    # Read the reusable answers before any file is rewritten.
    saved = {}
    if reuse:
        for entry in old_index:
            path = SITE_ROOT / entry["file"]
            if entry.get("language", "en") in languages and path.is_file():
                key = answer_key(entry["piece_id"], entry["question"], entry["measure_range"],
                                 entry.get("language", "en"))
                saved[key] = path.read_bytes()
    index = [entry for entry in old_index if entry.get("language", "en") not in languages]
    for language in languages:
        index.extend(export_language_answers(server, language, saved))
    order = {language: i for i, language in enumerate(QUESTION_LISTS)}
    pieces = list(sample_questions(SITE_ROOT / "app.js"))
    index.sort(key=lambda e: (pieces.index(e["piece_id"]), order[e["language"]], e["n"]))
    payload = {"answers": index}
    write(
        "answers/index.json",
        (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
    )
    # Remove answers of the exported languages that are no longer samples.
    listed = {entry["file"] for entry in index}
    for path in sorted((SITE_ROOT / "answers").glob("*/*.json")):
        match = re.fullmatch(r"\d+(?:\.([a-z]+))?\.json", path.name)
        rel_path = path.relative_to(SITE_ROOT).as_posix()
        if match and (match.group(1) or "en") in languages and rel_path not in listed:
            path.unlink()
            print(f"  removed {rel_path}")


def export_language_answers(server: str, language: str, saved: dict | None = None) -> list[dict]:
    print(f"Sample-question answers (language: {language}):")
    suffix = "" if language == "en" else f".{language}"
    index = []
    for piece_id, examples in sample_questions(SITE_ROOT / "app.js", language).items():
        for n, example in enumerate(examples, start=1):
            rel_path = f"answers/{piece_id}/{n}{suffix}.json"
            entry = {
                "piece_id": piece_id,
                "n": n,
                "question": example["text"],
                "measure_range": example["range"],
                "language": language,
                "file": rel_path,
            }
            key = answer_key(piece_id, example["text"], example["range"], language)
            if saved and key in saved:
                print(f"  reusing {piece_id} #{n}: {example['text']}", flush=True)
                write(rel_path, saved[key])
                index.append(entry)
                continue
            request = {
                "piece_id": piece_id,
                "question": example["text"],
                "measure_range": example["range"],
                "generate": True,
                "language": language,
            }
            print(f"  asking {piece_id} #{n}: {example['text']}", flush=True)
            body = fetch(
                server,
                "/api/ask",
                data=json.dumps(request).encode("utf-8"),
                timeout=ASK_TIMEOUT_SECONDS,
            )
            response = strip_local_paths(json.loads(body))  # fails on a non-JSON body
            write(rel_path, (json.dumps(response, ensure_ascii=False) + "\n").encode("utf-8"))
            index.append(entry)
    return index


def compare(reference_path: Path) -> int:
    """Compare saved answers with a list of {q_en, measure_range, answer_en, evidence_ids}."""
    reference = {
        (item["piece"], item["q_en"], tuple(item["measure_range"] or ())): item
        for item in json.loads(reference_path.read_text(encoding="utf-8"))
    }
    index = json.loads((SITE_ROOT / "answers/index.json").read_text(encoding="utf-8"))
    entries = [e for e in index["answers"] if e.get("language", "en") == "en"]
    differences = 0
    for entry in entries:
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
    print(f"{differences} of {len(entries)} answers differ")
    return differences


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--server", default="http://127.0.0.1:8792")
    parser.add_argument("--skip-data", action="store_true", help="do not re-export api/ and media/")
    parser.add_argument("--skip-answers", action="store_true", help="do not re-ask the sample questions")
    parser.add_argument(
        "--languages", default="en,ko",
        help="answer languages to export, comma-separated (default: en,ko)",
    )
    parser.add_argument(
        "--reuse", action="store_true",
        help="keep saved answers of unchanged sample questions; ask only new ones",
    )
    parser.add_argument("--compare", type=Path, help="reference English sample-answer JSON to compare with")
    args = parser.parse_args()
    languages = [language.strip() for language in args.languages.split(",") if language.strip()]
    unknown = sorted(set(languages) - set(QUESTION_LISTS))
    if unknown:
        parser.error(f"unknown language(s): {', '.join(unknown)}")
    server = args.server.rstrip("/")
    if not args.skip_data:
        export_data(server)
    if not args.skip_answers:
        export_answers(server, languages, reuse=args.reuse)
    if args.compare:
        compare(args.compare)


if __name__ == "__main__":
    sys.exit(main())
