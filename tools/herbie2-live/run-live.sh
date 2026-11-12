#!/usr/bin/env bash
# Live Soprano Lab demo (hybrid RAG + local Qwen3-14B) on 0.0.0.0:10001.
#
#   run-live.sh snapshot   soprano-lab 5768b94: the pipeline that produced the
#                          static page's saved answers (no prompt-injection
#                          guards, no Sumi Jo priority)
#   run-live.sh latest     soprano-lab 8bb4c13: Sumi Jo priority and
#                          prompt-injection guards (refuses more questions)
#
# Each version is its own clone here, pinned to a fixed commit, so that work in
# ~/soprano-lab, ~/soprano-qa-rag-system and ~/soprano-qa-demo never changes
# the running demo. Both read the dataset from ~/soprano-qa-dataset and the
# models from ~/soprano-lab/rag/models. The server restarts itself if it exits.
#
# Start or switch:  tmux kill-session -t soprano-live 2>/dev/null; \
#                   tmux new-session -d -s soprano-live ~/soprano-lab-live/run-live.sh snapshot
# Stop:             tmux kill-session -t soprano-live
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
VERSION="${1:-snapshot}"
PORT="${PORT:-10001}"
PYTHON="${PYTHON:-$HOME/miniconda3/envs/soprano-qa/bin/python}"
MODELS="${MODELS:-$HOME/soprano-lab/rag/models}"
DATASET="${DATASET:-$HOME/soprano-qa-dataset}"

if [ ! -f "$HERE/$VERSION/demo/server.py" ]; then
  echo "unknown version: $VERSION (expected snapshot or latest)" >&2
  exit 2
fi

export SOPRANO_QA_DATASET_ROOT="$DATASET"
export SOPRANO_QA_RAG_DATASET_ROOT="$DATASET"
export SOPRANO_QA_MODEL_PATH="$MODELS/Qwen3-14B-Q6_K.gguf"
export SOPRANO_QA_EMBEDDING_MODEL_PATH="$MODELS/Qwen3-Embedding-0.6B-Q8_0.gguf"
export PYTHONUNBUFFERED=1

cd "$HERE/$VERSION/demo"
while true; do
  echo "[$(date '+%F %T')] starting $VERSION ($(git log --format=%h -1)) on 0.0.0.0:$PORT"
  "$PYTHON" server.py --host 0.0.0.0 --port "$PORT"
  status=$?
  echo "[$(date '+%F %T')] server exited with status $status; restarting in 5 s"
  sleep 5
done 2>&1 | tee -a "$HERE/live-demo.log"
