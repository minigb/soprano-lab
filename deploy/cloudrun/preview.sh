#!/usr/bin/env bash
# Preview the web demo on this machine before deploying it: the page from the
# working tree's docs/ and the live API (soprano-qa-demo/server.py's handler
# with the soprano-qa-rag-system submodule, writing answers with Gemini on
# Vertex AI), in one process on one port. Uncommitted changes in docs/ and in
# both submodules all show.
#
#   deploy/cloudrun/preview.sh               # http://127.0.0.1:8797/
#   PORT=9000 deploy/cloudrun/preview.sh
#
# From your own computer, forward the port and open the page there:
#   ssh -L 8797:127.0.0.1:8797 <this host>   then  http://127.0.0.1:8797/
# Ctrl-C stops it. Questions are real Vertex AI calls, with no question limits.
# Question and feedback records are printed here, one JSON line each, instead
# of going to Cloud Logging.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$HERE" rev-parse --show-toplevel)"
PORT="${PORT:-8797}"
RAG_ROOT="${RAG_ROOT:-$REPO_ROOT/soprano-qa-rag-system}"
DATASET_ROOT="${DATASET_ROOT:-$REPO_ROOT/../soprano-qa-dataset}"
PYTHON="${PYTHON:-$HOME/miniconda3/envs/soprano-qa/bin/python}"
GEMINI_ENV="${GEMINI_ENV:-$HOME/gemini-vertex/env.sh}"

if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
  echo "Port $PORT is already in use (another preview? tmux ls)." >&2
  exit 1
fi
# deploy.sh builds from the submodule commits HEAD records; say when they differ.
if [[ -n "$(git -C "$REPO_ROOT" status --porcelain -- soprano-qa-rag-system soprano-qa-demo)" ]]; then
  echo "note: a submodule differs from what HEAD records; a deploy would use HEAD's" >&2
fi

# shellcheck source=/dev/null
source "$GEMINI_ENV" >/dev/null
export SOPRANO_QA_PIPELINE_ROOT="$RAG_ROOT"
export SOPRANO_QA_LLM_PROVIDER=vertex_gemini
export SOPRANO_QA_DATASET_ROOT="$DATASET_ROOT"
export SOPRANO_QA_RAG_DATASET_ROOT="$DATASET_ROOT"
export SOPRANO_LAB_WARMUP=1
export SOPRANO_LAB_RECORDS=1

exec "$PYTHON" "$HERE/preview.py" --port "$PORT" --docs "$REPO_ROOT/docs"
