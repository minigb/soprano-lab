#!/usr/bin/env python3
"""Soprano Lab -- dependency-free local web demo server.

Serves the frontend, audio from the source dataset, the demo's concatenated
sheet-music images and geometry, the alignment JSON needed for playback sync,
and the merged measure-aware RAG plus local-LLM question pipeline.

Usage:
    python3 server.py --host 127.0.0.1 --port 8765

Hosting the API for the static page (docs/) on another origin is configured
through environment variables, all off by default:

SOPRANO_LAB_ALLOWED_ORIGINS  comma-separated origins allowed by CORS,
                             e.g. https://minigb.github.io
SOPRANO_LAB_ASK_LIMIT        per-client question limit as COUNT/SECONDS,
                             e.g. 6/600
SOPRANO_LAB_DAILY_ASK_LIMIT  questions answered per rolling 24 hours
SOPRANO_LAB_TRUST_PROXY      1 to take the client address from the last
                             X-Forwarded-For entry (Cloud Run, other proxies)
SOPRANO_LAB_WARMUP           1 to load the retrieval index in the background at
                             startup; GET /api/health then waits (up to 2 min)
                             until it is ready, so on a host that throttles CPU
                             between requests (Cloud Run) the page's wake-up
                             call keeps the CPU on while the index loads
"""
from __future__ import annotations

import argparse
import collections
import inspect
import json
import mimetypes
import os
import re
import sys
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))

from backend import dataset, qa  # noqa: E402
from backend.translations import add_english_text  # noqa: E402

STATIC_ROOT = Path(__file__).resolve().parent / "static"

RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)")

SUPPORTED_LANGUAGES = ("ko", "en")
HANGUL_RE = re.compile(r"[\u1100-\u11ff\u3130-\u318f\ua960-\ua97f\uac00-\ud7af\ud7b0-\ud7ff]")


def infer_language(question: str) -> str:
    """Return "ko" when the question contains Hangul, otherwise "en"."""
    return "ko" if HANGUL_RE.search(question) else "en"


def pipeline_accepts_language(ask_callable) -> bool:
    """Whether the imported pipeline ask() takes a ``language`` keyword."""
    try:
        parameters = inspect.signature(ask_callable).parameters
    except (TypeError, ValueError):
        return False
    if "language" in parameters:
        return parameters["language"].kind in (
            inspect.Parameter.KEYWORD_ONLY,
            inspect.Parameter.POSITIONAL_OR_KEYWORD,
        )
    return False


MAX_ASK_BODY_BYTES = 64 * 1024
HEALTH_WARMUP_WAIT_SECONDS = 120
WARMED_UP = threading.Event()


def _allowed_origins() -> frozenset:
    raw = os.environ.get("SOPRANO_LAB_ALLOWED_ORIGINS", "")
    return frozenset(
        origin.strip().rstrip("/") for origin in raw.split(",") if origin.strip()
    )


def _parse_rate(value: str):
    """Parse "COUNT/SECONDS" into (count, seconds); None when unset."""
    value = (value or "").strip()
    if not value:
        return None
    count, _, seconds = value.partition("/")
    return int(count), float(seconds or 60)


class AskLimiter:
    """Sliding-window limits on answered questions, per client and overall.

    State is per process; deploy a single instance for exact limits.
    """

    def __init__(self, per_client=None, daily=None, clock=time.monotonic):
        self.per_client = per_client
        self.daily = daily
        self.clock = clock
        self._lock = threading.Lock()
        self._clients: dict = {}
        self._all: collections.deque = collections.deque()

    @classmethod
    def from_env(cls):
        daily = os.environ.get("SOPRANO_LAB_DAILY_ASK_LIMIT", "").strip()
        return cls(
            per_client=_parse_rate(os.environ.get("SOPRANO_LAB_ASK_LIMIT", "")),
            daily=int(daily) if daily else None,
        )

    @staticmethod
    def _expire(times, horizon):
        while times and times[0] <= horizon:
            times.popleft()

    def acquire(self, client: str):
        """Record one question, or return (scope, seconds to wait) when a
        limit is reached; scope is "client" or "daily"."""
        if not self.per_client and not self.daily:
            return None
        now = self.clock()
        with self._lock:
            if self.daily:
                self._expire(self._all, now - 86400)
                if len(self._all) >= self.daily:
                    return ("daily", self._all[0] + 86400 - now)
            if self.per_client:
                count, window = self.per_client
                times = self._clients.setdefault(client, collections.deque())
                self._expire(times, now - window)
                if len(times) >= count:
                    return ("client", times[0] + window - now)
                times.append(now)
                # Drop idle clients so the table stays small.
                if len(self._clients) > 10000:
                    for key in [k for k, v in self._clients.items() if not v]:
                        del self._clients[key]
            if self.daily:
                self._all.append(now)
        return None


ASK_LIMITER = AskLimiter.from_env()


REMOTE_MODEL_UNAVAILABLE = (
    "The live model could not answer right now. Please try again in a moment."
)


def _json_bytes(payload) -> bytes:
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


class Handler(BaseHTTPRequestHandler):
    server_version = "SopranoStudio/1.0"
    # Keep connections open between requests. With HTTP/1.0 the server closes
    # each connection after its response, and a proxy that reuses connections
    # (Cloud Run) can send the next request into one just closed; it retries
    # GETs but fails POSTs with an immediate 500. Every response sets
    # Content-Length, and paths that leave a request body unread close.
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # quieter default logging
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    # -- helpers ---------------------------------------------------------
    def end_headers(self):
        self._send_cors_headers()
        super().end_headers()

    def _send_cors_headers(self):
        # send_error() can run before the request headers were parsed.
        headers = getattr(self, "headers", None)
        origin = ((headers and headers.get("Origin")) or "").rstrip("/")
        if origin and origin in _allowed_origins():
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")

    def _client_address(self) -> str:
        if os.environ.get("SOPRANO_LAB_TRUST_PROXY") == "1":
            forwarded = self.headers.get("X-Forwarded-For", "")
            entries = [e.strip() for e in forwarded.split(",") if e.strip()]
            if entries:
                return entries[-1]
        return self.client_address[0]

    def _send_json(self, payload, status=200, headers=None):
        body = _json_bytes(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def _send_error_json(self, status, message):
        self._send_json({"error": message}, status=status)

    def _send_file(self, path: Path, content_type: str):
        try:
            data = path.read_bytes()
        except OSError:
            self._send_error_json(404, "file not found")
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            # Browsers may cancel an image request while switching pieces.
            # The response is already complete from the server's perspective.
            return

    def _send_audio(self, path: Path):
        try:
            size = path.stat().st_size
        except OSError:
            self._send_error_json(404, "audio not found")
            return

        range_header = self.headers.get("Range")
        start, end = 0, size - 1
        status = 200
        if range_header:
            m = RANGE_RE.match(range_header)
            if m:
                status = 206
                if m.group(1):
                    start = int(m.group(1))
                if m.group(2):
                    end = int(m.group(2))
                else:
                    end = size - 1
                start = max(0, min(start, size - 1))
                end = max(start, min(end, size - 1))

        length = end - start + 1
        self.send_response(status)
        self.send_header("Content-Type", "audio/mpeg")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        with open(path, "rb") as f:
            f.seek(start)
            remaining = length
            chunk_size = 1024 * 256
            while remaining > 0:
                chunk = f.read(min(chunk_size, remaining))
                if not chunk:
                    break
                try:
                    self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    return
                remaining -= len(chunk)

    # -- routing -----------------------------------------------------------
    def do_GET(self):
        try:
            path = unquote(urlsplit(self.path).path)
            if path == "/":
                self._send_file(STATIC_ROOT / "index.html", "text/html; charset=utf-8")
                return
            if path.startswith("/static/"):
                self._serve_static(path[len("/static/") :])
                return
            if path == "/api/health":
                # The static page calls this on load to wake a scaled-to-zero
                # host. With the startup warm-up on, it stays open until the
                # index is loaded: a host that throttles CPU between requests
                # then loads it now, not during the visitor's first question.
                ready = True
                if os.environ.get("SOPRANO_LAB_WARMUP") == "1":
                    ready = WARMED_UP.wait(HEALTH_WARMUP_WAIT_SECONDS)
                self._send_json(
                    {"ok": True, "ready": ready, "model": qa.model_status()}
                )
                return
            if path == "/api/pieces":
                self._send_json({"pieces": dataset.list_pieces()})
                return
            if path == "/api/corpus_stats":
                self._send_json(qa.corpus_stats())
                return

            m = re.match(r"^/api/pieces/([a-z0-9-]+)/score$", path)
            if m:
                payload = dataset.score_payload(m.group(1))
                if payload is None:
                    self._send_error_json(404, "no score geometry for this piece yet")
                else:
                    self._send_json(payload)
                return

            m = re.match(r"^/api/pieces/([a-z0-9-]+)/alignment$", path)
            if m:
                self._send_json(dataset.alignment_payload(m.group(1)))
                return

            m = re.match(r"^/media/audio/([a-z0-9-]+)\.mp3$", path)
            if m:
                self._send_audio(dataset.audio_path(m.group(1)))
                return

            m = re.match(
                r"^/media/score/([a-z0-9-]+)/(Concatenated)\.png$", path
            )
            if m:
                self._send_file(
                    dataset.image_path(m.group(1), m.group(2)), "image/png"
                )
                return

            self._send_error_json(404, "not found")
        except qa.BACKEND_UNAVAILABLE_ERRORS as exc:
            self._send_error_json(503, str(exc))
        except Exception:
            traceback.print_exc()
            self._send_error_json(500, "internal error")

    def _serve_static(self, rel_path: str):
        rel_path = rel_path or "index.html"
        candidate = (STATIC_ROOT / rel_path).resolve()
        if STATIC_ROOT not in candidate.parents and candidate != STATIC_ROOT:
            self._send_error_json(403, "forbidden")
            return
        if not candidate.is_file():
            self._send_error_json(404, "not found")
            return
        content_type = mimetypes.guess_type(str(candidate))[0] or "application/octet-stream"
        self._send_file(candidate, content_type)

    def do_OPTIONS(self):
        # CORS preflight for POST /api/ask with a JSON body.
        self.send_response(204)
        if (self.headers.get("Origin") or "").rstrip("/") in _allowed_origins():
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Max-Age", "86400")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_POST(self):
        try:
            path = urlsplit(self.path).path
            if path == "/api/ask":
                self._handle_ask()
                return
            self.close_connection = True  # the request body was not read
            self._send_error_json(404, "not found")
        except qa.BACKEND_UNAVAILABLE_ERRORS as exc:
            self._send_error_json(503, str(exc))
        except qa.REMOTE_MODEL_ERRORS:
            traceback.print_exc()
            self._send_error_json(503, REMOTE_MODEL_UNAVAILABLE)
        except Exception:
            traceback.print_exc()
            self._send_error_json(500, "internal error")

    def _handle_ask(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.close_connection = True
            self._send_error_json(400, "invalid Content-Length")
            return
        if length < 0 or length > MAX_ASK_BODY_BYTES:
            self.close_connection = True
            self._send_error_json(413, "request body too large")
            return
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._send_error_json(400, "invalid JSON body")
            return
        if not isinstance(body, dict):
            self._send_error_json(400, "request body must be a JSON object")
            return

        piece_id = body.get("piece_id")
        question_value = body.get("question")
        measure_range = body.get("measure_range")
        want_generation = body.get("generate", True)
        language = body.get("language")

        if piece_id not in dataset.PIECE_IDS:
            self._send_error_json(400, "unknown piece_id")
            return
        if not isinstance(question_value, str):
            self._send_error_json(400, "question must be a string")
            return
        question = question_value.strip()
        if not question:
            self._send_error_json(400, "question is required")
            return
        if not isinstance(want_generation, bool):
            self._send_error_json(400, "generate must be true or false")
            return
        if language is None:
            language = infer_language(question)
        elif language not in SUPPORTED_LANGUAGES:
            self._send_error_json(400, 'language must be "ko" or "en"')
            return

        piece_status = dataset.piece_status(piece_id)

        range_tuple = None
        if measure_range is not None:
            if (
                not isinstance(measure_range, list)
                or len(measure_range) != 2
                or any(
                    isinstance(value, bool) or not isinstance(value, int)
                    for value in measure_range
                )
            ):
                self._send_error_json(400, "measure_range must be [start, end]")
                return
            start, end = measure_range
            if start < 1 or end < start:
                self._send_error_json(400, "measure_range must be ascending and >= 1")
                return
            max_measure = piece_status["max_measure_number"]
            if max_measure is not None and end > max_measure:
                self._send_error_json(
                    400, f"measure_range exceeds this piece's known range (1-{max_measure})"
                )
                return
            range_tuple = (start, end)

        # Client-side scope errors are checked here so that a ValueError
        # raised later inside the pipeline (e.g. an exhausted model context)
        # is reported as a server error rather than a bad request.
        try:
            qa.validate_question_measure_contract(
                question,
                [list(range_tuple)] if range_tuple else [],
            )
        except ValueError as exc:
            self._send_error_json(400, str(exc))
            return

        limited = ASK_LIMITER.acquire(self._client_address())
        if limited:
            scope, wait = limited
            message = (
                "The live demo has reached its daily question limit. "
                "Please try again later."
                if scope == "daily"
                else "Too many questions in a short time. "
                "Please wait a few minutes and try again."
            )
            self._send_json(
                {"error": message, "retry_after": int(wait) + 1},
                status=429,
                headers={"Retry-After": str(int(wait) + 1)},
            )
            return

        ask_kwargs = {
            "piece_id": piece_id,
            "question": question,
            "measure_range": range_tuple,
            "generate": want_generation,
        }
        language_supported = pipeline_accepts_language(qa.ask)
        if language_supported:
            ask_kwargs["language"] = language
        try:
            result = qa.ask(**ask_kwargs)
        except qa.GeneratedAnswerRejected as exc:
            self._send_error_json(
                502, f"the model returned no usable grounded answer: {exc}"
            )
            return
        if isinstance(result, dict):
            result = dict(result)
            # Report the language actually used: the pipeline's own value when
            # it returns one, else the request language if it was passed
            # through, else the pipeline's implicit default (Korean).
            result.setdefault(
                "language", language if language_supported else "ko"
            )
            result["requested_language"] = language
            result["language_supported"] = language_supported
            if result["language"] == "en":
                add_english_text(result)
        self._send_json(result)


def _warm_up():
    """Validate the corpus and load the retrieval index before a question."""
    started = time.monotonic()
    try:
        qa.corpus_stats()
    except Exception:
        traceback.print_exc()
        return
    WARMED_UP.set()
    print(f"Retrieval index ready in {time.monotonic() - started:.1f} s", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Soprano Lab listening on http://{args.host}:{args.port}", flush=True)
    # Listen first: a host such as Cloud Run drops requests that wait too
    # long for a starting instance, while a question that reaches a running
    # server just waits for the index.
    if os.environ.get("SOPRANO_LAB_WARMUP") == "1":
        threading.Thread(target=_warm_up, daemon=True).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
