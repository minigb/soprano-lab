#!/usr/bin/env bash
# Keep the live API warm: a Cloud Scheduler job calls /api/health every five
# minutes. Cloud Run keeps an idle instance for up to 15 minutes without
# billing it, so the instance, with its index loaded, rarely shuts down.
# See README.md ("Keeping the instance warm").
#
#   source ~/gemini-vertex/env.sh
#   deploy/cloudrun/keep_warm.sh            # create or update the job
#   deploy/cloudrun/keep_warm.sh --delete   # remove it; cold starts return
set -euo pipefail

PROJECT="${GOOGLE_CLOUD_PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}"
: "${PROJECT:?set GOOGLE_CLOUD_PROJECT (source your gemini-vertex env.sh)}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-soprano-lab-api}"
JOB="${KEEP_WARM_JOB:-$SERVICE-keep-warm}"
SCHEDULE="${KEEP_WARM_SCHEDULE:-*/5 * * * *}"

where=(--project "$PROJECT" --location "$REGION")

if [[ ${1:-} == --delete ]]; then
  gcloud scheduler jobs delete "$JOB" "${where[@]}" --quiet
  exit
fi

gcloud services enable cloudscheduler.googleapis.com --project "$PROJECT"

url="$(gcloud run services describe "$SERVICE" --project "$PROJECT" \
  --region "$REGION" --format 'value(status.url)')"

# On a new instance /api/health waits up to 2 min for the warm-up; allow 3.
job=("${where[@]}" --schedule "$SCHEDULE" --uri "$url/api/health"
  --http-method GET --attempt-deadline 180s)
if gcloud scheduler jobs describe "$JOB" "${where[@]}" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "$JOB" "${job[@]}"
else
  gcloud scheduler jobs create http "$JOB" "${job[@]}"
fi
echo "$JOB calls $url/api/health on \"$SCHEDULE\" (UTC)."
