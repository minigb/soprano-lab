"""Image build step: verify the bundled dataset and warm the retrieval index.

Run from the RAG repository root during the Docker build (see Dockerfile),
with SOPRANO_QA_SETTINGS selecting the web settings. The bundled dataset must
be the revision the committed corpus (data/) was built from: its input
fingerprint is location-independent, so a mismatch means the dataset checkout
used for the deploy differs from the one behind the committed corpus. The
corpus is then rebuilt for the image's dataset path (the stats record the
absolute path) and embedded on CPU, which fills the embedding cache.
"""
from __future__ import annotations

import json
import os
import sys
import time

sys.path.insert(0, os.getcwd())

from soprano_qa.corpus import corpus_input_fingerprint, file_sha256  # noqa: E402
from soprano_qa.settings import load_settings  # noqa: E402


def main() -> None:
    settings = load_settings()
    with open(settings["stats_path"], encoding="utf-8") as f:
        committed = json.load(f)
    fingerprint = corpus_input_fingerprint(settings)
    if fingerprint != committed.get("input_fingerprint"):
        sys.exit(
            "The bundled dataset is not the revision data/corpus.json was "
            "built from (input fingerprint %s, expected %s). Deploy from the "
            "matching dataset revision, or rebuild and commit the corpus."
            % (fingerprint, committed.get("input_fingerprint"))
        )
    committed_sha = committed.get("corpus_sha256")

    started = time.monotonic()
    from soprano_qa import service  # noqa: E402  (loads the same settings)

    stats = service.corpus_stats()
    rebuilt_sha = file_sha256(settings["corpus_path"])
    print(
        "Corpus: %d records, rebuilt corpus %s the committed one; "
        "index ready in %.0f s"
        % (
            stats.get("total_records", -1),
            "matches" if rebuilt_sha == committed_sha else "DIFFERS FROM",
            time.monotonic() - started,
        )
    )
    if rebuilt_sha != committed_sha:
        sys.exit("The rebuilt corpus differs from data/corpus.json.")
    print(json.dumps(stats.get("retrieval", {}), ensure_ascii=False)[:2000])


if __name__ == "__main__":
    main()
