#!/usr/bin/env bash
# Build the Soprano Lab live API image with Cloud Build, deploy it to Cloud
# Run with Gemini on Vertex AI, and point the static page (docs/index.html)
# at it. See README.md.
#
#   source ~/gemini-vertex/env.sh            # gcloud, account and project
#   deploy/cloudrun/deploy.sh                # build, deploy, update docs/index.html
#   deploy/cloudrun/deploy.sh --context-only # only assemble the build context
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$HERE" rev-parse --show-toplevel)"

PROJECT="${GOOGLE_CLOUD_PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-soprano-lab-api}"
REPOSITORY="${REPOSITORY:-soprano-lab}"
RUNTIME_ACCOUNT_NAME="${RUNTIME_ACCOUNT_NAME:-soprano-lab-api}"
RAG_REPO="${RAG_REPO:-$REPO_ROOT/../soprano-qa-rag-system}"
RAG_REF="${RAG_REF:-web-demo-gemini}"
DATASET="${SOPRANO_QA_DATASET_ROOT:-$REPO_ROOT/../soprano-qa-dataset}"
DATASET_REF="${DATASET_REF:-HEAD}"
ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-https://minigb.github.io}"
ASK_LIMIT="${ASK_LIMIT:-6/600}"
DAILY_ASK_LIMIT="${DAILY_ASK_LIMIT:-200}"
BUILD_MACHINE="${BUILD_MACHINE:-e2-highcpu-8}"

# What the image needs from the RAG repository (no evaluations, tests, sites).
RAG_PATHS=(soprano_qa config data scripts requirements.txt requirements-vertex.txt)

# Dataset files the pipeline and server read (corpus inputs, lyrics, score
# geometry, alignments, English translations). Audio and score images are
# served by GitHub Pages from docs/, not by the API.
DATASET_PATHS=(
  alignment/result
  database/exports/research-open.jsonl
  database/exports/research-conditional.jsonl
  database/records/sources.jsonl
  database/records/claims.jsonl
  database/records/chunks.jsonl
  database/reports/facts-only-release-audit.json
  english/expert_curation/review
  english/source_snapshot/expert_curation/review
  expert_curation/review
  sheet_music/lyrics
  sheet_music/result
  sheet_music/validate_lyrics.py
  sumijo-feedback
  web_coaching/sources
  web_coaching/units
  web_coaching/snapshots
  web_coaching/transcripts
  web_coaching/tools/validate.py
)

context_only=0
for arg in "$@"; do
  case "$arg" in
    --context-only) context_only=1 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

assemble_context() {
  local context="$1"
  mkdir -p "$context/soprano-lab" "$context/soprano-qa-rag-system" "$context/soprano-qa-dataset"
  if [[ -n "$(git -C "$REPO_ROOT" status --porcelain -- demo deploy)" ]]; then
    echo "warning: demo/ or deploy/ has uncommitted changes; deploying git HEAD" >&2
  fi
  git -C "$REPO_ROOT" archive HEAD demo | tar -x -C "$context/soprano-lab"
  rm -rf "$context/soprano-lab/demo/tests"
  git -C "$REPO_ROOT" show HEAD:deploy/cloudrun/Dockerfile > "$context/Dockerfile"
  git -C "$REPO_ROOT" show HEAD:deploy/cloudrun/prepare_image.py > "$context/prepare_image.py"
  git -C "$RAG_REPO" archive "$RAG_REF" -- "${RAG_PATHS[@]}" \
    | tar -x -C "$context/soprano-qa-rag-system"
  git -C "$DATASET" archive "$DATASET_REF" -- "${DATASET_PATHS[@]}" \
    | tar -x -C "$context/soprano-qa-dataset"
  echo "Build context: $context ($(du -sh "$context" | cut -f1));" \
    "RAG $(git -C "$RAG_REPO" rev-parse --short "$RAG_REF"), dataset $(git -C "$DATASET" rev-parse --short "$DATASET_REF")"
}

if (( context_only )); then
  context="${CONTEXT_DIR:-$(mktemp -d)}"
  assemble_context "$context"
  exit 0
fi

: "${PROJECT:?set GOOGLE_CLOUD_PROJECT (source your gemini-vertex env.sh)}"
if [[ "$(gcloud billing projects describe "$PROJECT" --format 'value(billingEnabled)')" != "True" ]]; then
  echo "Billing is not enabled on $PROJECT; Cloud Run and Vertex AI need it." >&2
  exit 1
fi
IMAGE="$REGION-docker.pkg.dev/$PROJECT/$REPOSITORY/$SERVICE:$(git -C "$REPO_ROOT" rev-parse --short HEAD)-$(git -C "$RAG_REPO" rev-parse --short "$RAG_REF")"
RUNTIME_ACCOUNT="$RUNTIME_ACCOUNT_NAME@$PROJECT.iam.gserviceaccount.com"

# Run "$@" until it succeeds, up to $1 attempts 15 s apart (newly enabled
# APIs and new service accounts take a little while to become usable).
retry() {
  local attempts="$1" n=1
  shift
  until "$@"; do
    (( n++ < attempts )) || return 1
    echo "Retrying in 15 s ($n/$attempts): $1 $2 $3…" >&2
    sleep 15
  done
}

echo "Enabling APIs (no-op when already enabled)…"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com aiplatform.googleapis.com --project "$PROJECT"
retry 12 gcloud artifacts repositories list --project "$PROJECT" \
  --location "$REGION" --quiet >/dev/null
retry 12 gcloud builds list --project "$PROJECT" --region "$REGION" \
  --limit 1 --quiet >/dev/null

if ! gcloud artifacts repositories describe "$REPOSITORY" \
    --location "$REGION" --project "$PROJECT" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$REPOSITORY" --repository-format docker \
    --location "$REGION" --project "$PROJECT" \
    --description "Soprano Lab live API images"
fi

# The service runs as its own account, allowed only to call Vertex AI models.
if ! gcloud iam service-accounts describe "$RUNTIME_ACCOUNT" --project "$PROJECT" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$RUNTIME_ACCOUNT_NAME" --project "$PROJECT" \
    --display-name "Soprano Lab live API"
fi
retry 8 gcloud projects add-iam-policy-binding "$PROJECT" --condition None \
  --member "serviceAccount:$RUNTIME_ACCOUNT" --role roles/aiplatform.user >/dev/null

# Cloud Build runs as the Compute Engine default service account, which new
# projects no longer give broad roles; grant only what this build needs.
project_number="$(gcloud projects describe "$PROJECT" --format 'value(projectNumber)')"
build_account="serviceAccount:$project_number-compute@developer.gserviceaccount.com"
source_bucket="gs://${PROJECT}_cloudbuild"
if ! gcloud storage buckets describe "$source_bucket" --project "$PROJECT" >/dev/null 2>&1; then
  gcloud storage buckets create "$source_bucket" --project "$PROJECT" --location US
fi
gcloud storage buckets add-iam-policy-binding "$source_bucket" --project "$PROJECT" \
  --member "$build_account" --role roles/storage.objectViewer >/dev/null
gcloud artifacts repositories add-iam-policy-binding "$REPOSITORY" --project "$PROJECT" \
  --location "$REGION" --member "$build_account" --role roles/artifactregistry.writer >/dev/null
gcloud projects add-iam-policy-binding "$PROJECT" --condition None \
  --member "$build_account" --role roles/logging.logWriter >/dev/null

context="$(mktemp -d)"
trap 'rm -rf "$context"' EXIT
assemble_context "$context"

# A build refused within a minute never started (permissions still
# propagating in a new project); retry those, not failed builds.
for attempt in 1 2 3; do
  started=$SECONDS
  if gcloud builds submit "$context" --project "$PROJECT" --region "$REGION" \
      --tag "$IMAGE" --machine-type "$BUILD_MACHINE" --timeout 45m; then
    break
  fi
  if (( attempt == 3 || SECONDS - started > 60 )); then
    exit 1
  fi
  echo "Build was refused before starting; retrying in 60 s…" >&2
  sleep 60
done

env_vars="GOOGLE_CLOUD_PROJECT=$PROJECT"
env_vars+="@SOPRANO_LAB_ALLOWED_ORIGINS=$ALLOWED_ORIGINS"
env_vars+="@SOPRANO_LAB_ASK_LIMIT=$ASK_LIMIT"
env_vars+="@SOPRANO_LAB_DAILY_ASK_LIMIT=$DAILY_ASK_LIMIT"

# One instance at most: the question limits are per process, and it caps cost.
# Scales to zero when idle; the page wakes it with /api/health.
gcloud run deploy "$SERVICE" --project "$PROJECT" --region "$REGION" \
  --image "$IMAGE" --service-account "$RUNTIME_ACCOUNT" --allow-unauthenticated \
  --cpu 2 --memory 4Gi --concurrency 8 --timeout 300 \
  --min-instances 0 --max-instances 1 --cpu-boost \
  --set-env-vars "^@^$env_vars"

url="$(gcloud run services describe "$SERVICE" --project "$PROJECT" \
  --region "$REGION" --format 'value(status.url)')"
echo "Live API: $url"
curl -fsS "$url/api/health" && echo

sed -i -E "s#(<meta name=\"soprano-lab-api\" content=\")[^\"]*(\" />)#\1$url\2#" \
  "$REPO_ROOT/docs/index.html"
echo "docs/index.html now points at $url; commit and push it to publish."
