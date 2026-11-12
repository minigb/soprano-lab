#!/usr/bin/env bash
# Preview the web demo on this machine before deploying it: the page from the
# working tree's docs/ and the live API (demo/server.py's handler with the RAG
# web branch's working tree, writing answers with Gemini on Vertex AI), in one
# process on one port. Uncommitted changes in docs/, demo/ and the RAG
# worktree all show.
#
#   deploy/cloudrun/preview.sh               # http://127.0.0.1:8797/
#   PORT=9000 deploy/cloudrun/preview.sh
#
# From your own computer, forward the port and open the page there:
#   ssh -L 8797:127.0.0.1:8797 <this host>   then  http://127.0.0.1:8797/
# Ctrl-C stops it. Questions are real Vertex AI calls, with no question limits.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$HERE" rev-parse --show-toplevel)"
PORT="${PORT:-8797}"
RAG_ROOT="${RAG_ROOT:-$REPO_ROOT/../soprano-qa-rag-system-web}"
RAG_REF="${RAG_REF:-web-demo-gemini}"
PYTHON="${PYTHON:-$HOME/miniconda3/envs/soprano-qa/bin/python}"
GEMINI_ENV="${GEMINI_ENV:-$HOME/gemini-vertex/env.sh}"

if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
  echo "Port $PORT is already in use (another preview? tmux ls)." >&2
  exit 1
fi
# deploy.sh builds from the RAG_REF commit; say when the worktree differs.
if [[ "$(git -C "$RAG_ROOT" rev-parse HEAD)" != "$(git -C "$RAG_ROOT" rev-parse "$RAG_REF")" ]] \
    || [[ -n "$(git -C "$RAG_ROOT" status --porcelain -- soprano_qa config data)" ]]; then
  echo "note: $RAG_ROOT is not exactly $RAG_REF; a deploy would use $RAG_REF" >&2
fi

# shellcheck source=/dev/null
source "$GEMINI_ENV" >/dev/null
export SOPRANO_QA_PIPELINE_ROOT="$RAG_ROOT"
export SOPRANO_QA_SETTINGS="$RAG_ROOT/config/settings.web.json"
export SOPRANO_LAB_WARMUP=1

exec "$PYTHON" "$HERE/preview.py" --port "$PORT" --docs "$REPO_ROOT/docs"
