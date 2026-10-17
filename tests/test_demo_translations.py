import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from backend import translations


def _write(path: Path, units: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"knowledge_units": [{"knowledge_unit_id": k, "answer": v} for k, v in units.items()]}
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


class EnglishUnitTextTests(unittest.TestCase):
    def setUp(self):
        translations.english_unit_texts.cache_clear()
        self.addCleanup(translations.english_unit_texts.cache_clear)

    def test_only_current_translations_are_offered(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dataset, english = root / "ko", root / "en"
            review = "expert_curation/review/piece.json"
            _write(dataset / review, {"piece-ku-001": "현재", "piece-ku-002": "바뀐 문장", "piece-ku-003": "번역 없음"})
            _write(english / "source_snapshot" / review, {"piece-ku-001": "현재", "piece-ku-002": "예전 문장", "piece-ku-003": "번역 없음"})
            _write(english / review, {"piece-ku-001": "Current", "piece-ku-002": "Old sentence"})
            with mock.patch.object(translations, "DATASET_ROOT", dataset), \
                 mock.patch.object(translations, "ENGLISH_DATASET_ROOT", english):
                texts = translations.english_unit_texts()
        self.assertEqual(texts, {"piece-ku-001": "Current"})

    def test_add_english_text_touches_expert_evidence_only(self):
        result = {"evidence": [
            {"id": "piece-ku-001", "kind": "expert", "text": "현재"},
            {"id": "piece-ku-001", "kind": "web", "text": "웹"},
            {"id": "piece-ku-009", "kind": "expert", "text": "번역 없음"},
        ]}
        with mock.patch.object(translations, "english_unit_texts", return_value={"piece-ku-001": "Current"}):
            translations.add_english_text(result)
        self.assertEqual(result["evidence"][0]["text_en"], "Current")
        self.assertNotIn("text_en", result["evidence"][1])
        self.assertNotIn("text_en", result["evidence"][2])


if __name__ == "__main__":
    unittest.main()
