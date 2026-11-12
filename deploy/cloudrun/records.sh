#!/usr/bin/env bash
# Print the live demo's saved questions and feedback, one JSON object per line,
# oldest first. See README.md ("Saved questions and feedback").
#
#   source ~/gemini-vertex/env.sh
#   deploy/cloudrun/records.sh > records.jsonl     # everything kept
#   DAYS=7 deploy/cloudrun/records.sh              # the last 7 days
set -euo pipefail

PROJECT="${GOOGLE_CLOUD_PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}"
: "${PROJECT:?set GOOGLE_CLOUD_PROJECT (source your gemini-vertex env.sh)}"
RECORDS_BUCKET="${RECORDS_BUCKET:-soprano-lab-records}"
DAYS="${DAYS:-3650}"

gcloud logging read \
  'jsonPayload.event="soprano_lab_question" OR jsonPayload.event="soprano_lab_feedback"' \
  --project "$PROJECT" --bucket "$RECORDS_BUCKET" --location global \
  --view _AllLogs --freshness "${DAYS}d" --order asc --format json \
  | python3 -c '
import json, sys
for entry in json.load(sys.stdin):
    print(json.dumps(entry["jsonPayload"], ensure_ascii=False))
'
