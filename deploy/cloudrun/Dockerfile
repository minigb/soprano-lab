# Soprano Lab live API for the static page (docs/): the demo server with the
# measure-aware RAG pipeline on CPU, writing answers with Gemini on Vertex AI
# (SOPRANO_QA_LLM_PROVIDER=vertex_gemini; everything else is the RAG
# repository's default configuration).
#
# deploy.sh assembles the build context; it is not this directory:
#   soprano-qa-rag-system/  the RAG repository at RAG_REF (code, config, corpus)
#   soprano-qa-demo/        the demo server at DEMO_REF
#   soprano-qa-dataset/     the dataset files the pipeline reads (private)
#   prepare_image.py        corpus check and embedding warm-up, below
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    SOPRANO_QA_PIPELINE_ROOT=/app/soprano-qa-rag-system \
    SOPRANO_QA_LLM_PROVIDER=vertex_gemini \
    SOPRANO_QA_DATASET_ROOT=/app/soprano-qa-dataset \
    GOOGLE_CLOUD_LOCATION=global

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# The repositories sit side by side, as in their own checkout instructions,
# so the default settings' relative dataset path resolves.
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
COPY soprano-qa-demo /app/soprano-qa-demo
WORKDIR /app/soprano-qa-demo
ENV PORT=8080 \
    SOPRANO_LAB_TRUST_PROXY=1 \
    SOPRANO_LAB_WARMUP=1
CMD ["sh", "-c", "exec python server.py --host 0.0.0.0 --port \"$PORT\""]
