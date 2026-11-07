# Soprano Lab live API for the static page (docs/): demo/server.py with the
# measure-aware RAG pipeline on CPU, writing answers with Gemini on Vertex AI
# (config/settings.web.json of the RAG repository).
#
# deploy.sh assembles the build context; it is not this directory:
#   soprano-qa-rag-system/  the RAG repository at RAG_REF (code, config, corpus)
#   soprano-qa-dataset/     the dataset files the pipeline reads (private)
#   soprano-lab/demo/       this repository's demo server (git HEAD)
#   prepare_image.py        corpus check and embedding warm-up, below
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    SOPRANO_QA_PIPELINE_ROOT=/app/soprano-qa-rag-system \
    SOPRANO_QA_SETTINGS=/app/soprano-qa-rag-system/config/settings.web.json \
    SOPRANO_QA_DATASET_ROOT=/app/soprano-qa-dataset \
    GOOGLE_CLOUD_LOCATION=global

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Same layout as the RAG repository's own checkout instructions, so the
# settings' relative dataset path resolves.
COPY soprano-qa-rag-system/requirements.txt soprano-qa-rag-system/requirements-vertex.txt /tmp/req/
# CPU build of llama-cpp-python (only the Qwen3-Embedding retrieval model runs
# here) and the Vertex SDK pinned by the RAG repository.
RUN pip install --no-cache-dir \
      --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu \
      -r /tmp/req/requirements.txt -r /tmp/req/requirements-vertex.txt \
      "llama-cpp-python==0.3.32"

COPY soprano-qa-dataset /app/soprano-qa-dataset
COPY soprano-qa-rag-system /app/soprano-qa-rag-system
COPY prepare_image.py /app/prepare_image.py

WORKDIR /app/soprano-qa-rag-system
RUN python scripts/download_embedding_model.py
# Check the dataset matches the committed corpus, rebuild the corpus for this
# path and embed it once, so instances start with a filled embedding cache.
# No Vertex call is made; the project name is only needed to load settings.
RUN GOOGLE_CLOUD_PROJECT=image-build python /app/prepare_image.py

# The demo server comes last, so changing it leaves the layers above intact.
COPY soprano-lab /app/soprano-lab
WORKDIR /app/soprano-lab/demo
ENV PORT=8080 \
    SOPRANO_LAB_TRUST_PROXY=1 \
    SOPRANO_LAB_WARMUP=1
CMD ["sh", "-c", "exec python server.py --host 0.0.0.0 --port \"$PORT\""]
