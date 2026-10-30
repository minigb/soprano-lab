#!/usr/bin/env python3
"""Regenerate the static Soprano Lab snapshot from a running demo server.

The script talks to a running demo server (``demo/server.py``) and
writes, relative to the site root (the parent of this ``tools/`` directory):

* ``api/pieces.json``, ``api/pieces/<id>/score.json`` and
  ``api/pieces/<id>/alignment.json``: the exact bodies of the server's GET
  endpoints;
* ``media/audio/<id>.mp3`` and ``media/score/<id>/<page>.png``: the media
  files the frontend loads;
* ``answers/<piece>/<n>.json``: the ``POST /api/ask`` responses (absolute local
  file paths reduced to file names) for the
  sample questions listed in ``EXAMPLE_QUESTIONS`` in ``app.js`` (``n`` is the
  1-based chip position), asked with ``language: "en"`` and the chip's measure
  range (or the whole piece), plus ``answers/index.json``;
* ``answers/manifest.json``: export timestamps, requests, saved-response hashes,
  and server-reported model metadata. This describes a static snapshot, not a
  live API or a verified identity of the server's source/settings/checkpoint.

Only the standard library is used. Example:

    python3 tools/export.py --server http://127.0.0.1:8792
    python3 tools/export.py --skip-answers          # data and media only
    python3 tools/export.py --compare other_run.json  # report answer diffs
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
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


def export_answers(server: str) -> None:
    print("Sample-question answers (language: en):")
    started_at = datetime.now(timezone.utc).isoformat()
    examples_by_piece = sample_questions(SITE_ROOT / "app.js")
    index = []
    saved_responses = []
    provenance = []
    for piece_id, examples in examples_by_piece.items():
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
            response = strip_local_paths(json.loads(body))  # fails on a non-JSON body
            rel_path = f"answers/{piece_id}/{n}.json"
            saved_body = (json.dumps(response, ensure_ascii=False) + "\n").encode("utf-8")
            saved_responses.append((rel_path, saved_body))
            provenance.append({
                "file": rel_path,
                "sha256": hashlib.sha256(saved_body).hexdigest(),
                "received_at_utc": datetime.now(timezone.utc).isoformat(),
                "request": request,
                "server_reported_model": response.get("model"),
                "pipeline": response.get("pipeline"),
                "generation_mode": response.get("generation_mode"),
                "answer_basis": response.get("answer_basis"),
                "unavailable_reason": response.get("unavailable_reason"),
                "generation_validation_warning": response.get("generation_validation_warning"),
            })
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
    # Finish every request before replacing a snapshot: an HTTP failure must
    # not leave a mixture of old and new sample answers.
    for rel_path, saved_body in saved_responses:
        write(rel_path, saved_body)
    payload = {"answers": index}
    write(
        "answers/index.json",
        (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
    )
    manifest = {
        "schema_version": 1,
        "snapshot_type": "precomputed_sample_answers",
        "started_at_utc": started_at,
        "completed_at_utc": datetime.now(timezone.utc).isoformat(),
        "request_endpoint": "POST /api/ask",
        "identity_note": (
            "Model metadata is reported by the server, with local paths reduced to file names. "
            "No server source revision, settings identity, or checkpoint hash is inferred "
            "from the exporter's local checkout. Loading these files performs no inference."
        ),
        "exporter_script_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "frontend_app_sha256": hashlib.sha256((SITE_ROOT / "app.js").read_bytes()).hexdigest(),
        "answers": provenance,
    }
    write(
        "answers/manifest.json",
        (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
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
