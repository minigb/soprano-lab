"""Serve docs/ and the live API on one port, for preview.sh.

The page is served from the working tree's docs/, with its API meta tag
pointing at this same origin. Its API calls (GET /api/health, POST /api/ask,
POST /api/feedback) go to demo/server.py's request handler, run in this
process. Only
this one port is open, so an SSH tunnel or VS Code needs to forward just it,
and no CORS setup is needed. (A separate API port would get forwarded too, and
demo/server.py serves its own copy of the page, demo/static, at its root.)

Run it with the RAG pipeline's Python and environment; preview.sh sets them.
"""
from __future__ import annotations

import argparse
import html
import mimetypes
import os
import re
import sys
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "demo"))

import server as api  # noqa: E402  demo/server.py

META_RE = re.compile(r'(<meta name="soprano-lab-api" content=")[^"]*(")')
RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)$")


def make_handler(docs: Path):
    docs = docs.resolve()

    class Handler(api.Handler):
        server_version = "SopranoLabPreview"

        def log_message(self, fmt, *args):
            if not self.path.startswith(("/media/", "/api/pieces")):
                sys.stderr.write("%s %s\n" % (self.log_date_time_string(), fmt % args))

        def do_GET(self):
            path = self.path.split("?", 1)[0]
            if path == "/api/health":
                super().do_GET()
            else:
                self._preview_static(path)

        def do_HEAD(self):
            self._preview_static(self.path.split("?", 1)[0], head=True)

        def do_POST(self):
            if self.path.split("?", 1)[0] in ("/api/ask", "/api/feedback"):
                super().do_POST()
            else:
                self.close_connection = True  # the request body is left unread
                self._send_error_json(404, "not found")

        def _preview_static(self, path, head=False):
            rel = path.lstrip("/") or "index.html"
            if rel.endswith("/"):
                rel += "index.html"
            target = (docs / rel).resolve()
            if docs not in target.parents or not target.is_file():
                self._preview_send(404, b"not found", "text/plain", head=head)
                return
            ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
            if target == docs / "index.html":
                origin = "http://" + (self.headers.get("Host") or "127.0.0.1")
                page = target.read_text(encoding="utf-8")
                data = META_RE.sub(lambda m: m.group(1) + html.escape(origin) + m.group(2), page)
                self._preview_send(200, data.encode("utf-8"), "text/html; charset=utf-8", head=head)
                return
            data = target.read_bytes()
            match = RANGE_RE.match(self.headers.get("Range", "").strip())
            if match and (match.group(1) or match.group(2)):
                size = len(data)
                if match.group(1):
                    start = int(match.group(1))
                    end = min(int(match.group(2)), size - 1) if match.group(2) else size - 1
                else:
                    start, end = max(0, size - int(match.group(2))), size - 1
                if start > end or start >= size:
                    self._preview_send(416, b"", ctype, head=head,
                                       extra={"Content-Range": f"bytes */{size}"})
                    return
                self._preview_send(206, data[start:end + 1], ctype, head=head,
                                   extra={"Content-Range": f"bytes {start}-{end}/{size}"})
                return
            self._preview_send(200, data, ctype, head=head)

        def _preview_send(self, status, body, ctype, head=False, extra=None):
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Accept-Ranges", "bytes")
            # Always fetch the working tree's current files.
            self.send_header("Cache-Control", "no-store")
            for key, value in (extra or {}).items():
                self.send_header(key, value)
            self.end_headers()
            if not head:
                self.wfile.write(body)

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8797)
    parser.add_argument("--docs", type=Path, default=REPO_ROOT / "docs")
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), make_handler(args.docs))
    print(f"Preview: http://{args.host}:{args.port}/  (docs: {args.docs})", flush=True)
    if os.environ.get("SOPRANO_LAB_WARMUP") == "1":
        threading.Thread(target=api._warm_up, daemon=True).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
