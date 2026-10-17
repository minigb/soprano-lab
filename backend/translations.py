"""English display text for expert knowledge units.

The parallel English dataset (soprano-qa-dataset-english/english/) translates
each knowledge unit and keeps the Korean review files it was translated from.
A translation is offered only when that Korean text still equals the current
Korean unit text, so an outdated translation is never shown; otherwise the
Korean original is displayed.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from backend.dataset import DATASET_ROOT, PROJECT_ROOT, _external_root

ENGLISH_DATASET_ROOT = _external_root(
    "SOPRANO_QA_ENGLISH_DATASET_ROOT",
    PROJECT_ROOT.parent / "soprano-qa-dataset-english",
)


def _units(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return {u["knowledge_unit_id"]: u.get("answer", "") for u in data.get("knowledge_units", [])}


@lru_cache(maxsize=1)
def english_unit_texts() -> dict:
    """Map knowledge_unit_id -> English answer, for up-to-date translations only."""
    current_dir = DATASET_ROOT / "expert_curation" / "review"
    translated_from_dir = ENGLISH_DATASET_ROOT / "expert_curation" / "review"
    english_dir = ENGLISH_DATASET_ROOT / "english" / "expert_curation" / "review"
    texts = {}
    for current_path in sorted(current_dir.glob("*.json")):
        current = _units(current_path)
        source = _units(translated_from_dir / current_path.name)
        english = _units(english_dir / current_path.name)
        for unit_id, korean in current.items():
            if english.get(unit_id) and source.get(unit_id) == korean:
                texts[unit_id] = english[unit_id]
    return texts


def add_english_text(result: dict) -> None:
    """Attach ``text_en`` to expert evidence whose translation is current."""
    texts = english_unit_texts()
    for evidence in result.get("evidence") or []:
        if evidence.get("kind") == "expert" and evidence.get("id") in texts:
            evidence["text_en"] = texts[evidence["id"]]
