from __future__ import annotations

import json
import os
import tempfile
import unittest

from soprano_qa.answer import build_messages
from soprano_qa.score_context import (
    MAX_CONTEXT_MEASURES,
    format_score_context,
    load_measure_lyrics,
    selected_measure_lyrics,
)
from soprano_qa.settings import load_settings

FAKE_VALIDATOR = """
PIECES = ("die-forelle",)


def check(piece):
    return []
"""

LYRICS = {
    "schema_version": 1,
    "piece_id": "die-forelle",
    "status": "model_transcribed_unverified",
    "geometry_revision": 1,
    "line_labels": ["stanza 1", "stanza 2"],
    "measures": [
        {"measure": 1, "voice": "rest", "lyric_lines": [], "notes": ""},
        {"measure": 2, "voice": "sung", "lyric_lines": ["In ei- -nem", "Ein Fi- -scher"], "notes": ""},
        {"measure": 3, "voice": "sung", "lyric_lines": [], "notes": ""},
    ],
}


def write_dataset(root: str, *, validator: str = FAKE_VALIDATOR) -> None:
    lyrics_dir = os.path.join(root, "sheet_music", "lyrics")
    os.makedirs(lyrics_dir)
    with open(os.path.join(root, "sheet_music", "validate_lyrics.py"), "w", encoding="utf-8") as f:
        f.write(validator)
    with open(os.path.join(lyrics_dir, "die-forelle.json"), "w", encoding="utf-8") as f:
        json.dump(LYRICS, f, ensure_ascii=False)


class ScoreContextTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        write_dataset(self.temp.name)
        self.lyrics = load_measure_lyrics(self.temp.name)

    def test_selected_measures_only_and_prompt_block(self) -> None:
        context = selected_measure_lyrics(self.lyrics, "die-forelle", [[2, 3]])
        self.assertEqual([m["measure"] for m in context["measures"]], [2, 3])
        block = format_score_context(context)
        self.assertIn("bar 2: line 1: In ei- -nem | line 2: Ein Fi- -scher", block)
        self.assertIn("bar 3: (voice sings; no new text printed)", block)
        self.assertIn("line 2 = stanza 2", block)
        self.assertIn("model_transcribed_unverified", block)
        self.assertIn("Never infer musical or performance facts", block)

    def test_rests_unknown_pieces_and_no_range(self) -> None:
        context = selected_measure_lyrics(self.lyrics, "die-forelle", [[1, 1]])
        self.assertIn("bar 1: (voice rest)", format_score_context(context))
        self.assertIsNone(selected_measure_lyrics(self.lyrics, "la-capinera", [[1, 4]]))
        self.assertIsNone(selected_measure_lyrics(self.lyrics, "die-forelle", []))
        self.assertIsNone(selected_measure_lyrics(self.lyrics, "die-forelle", [[90, 95]]))
        self.assertEqual(format_score_context(None), "")

    def test_long_selection_is_truncated(self) -> None:
        many = dict(LYRICS, measures=[
            {"measure": n, "voice": "sung", "lyric_lines": ["la"], "notes": ""}
            for n in range(1, MAX_CONTEXT_MEASURES + 10)
        ])
        other = tempfile.TemporaryDirectory()
        self.addCleanup(other.cleanup)
        write_dataset(other.name)
        with open(os.path.join(other.name, "sheet_music", "lyrics", "die-forelle.json"), "w", encoding="utf-8") as f:
            json.dump(many, f)
        context = selected_measure_lyrics(load_measure_lyrics(other.name), "die-forelle", [[1, 40]])
        self.assertTrue(context["truncated"])
        self.assertEqual(len(context["measures"]), MAX_CONTEXT_MEASURES)

    def test_validator_errors_fail_closed(self) -> None:
        bad = tempfile.TemporaryDirectory()
        self.addCleanup(bad.cleanup)
        write_dataset(bad.name, validator='PIECES = ("die-forelle",)\n\ndef check(piece):\n    return ["m2: bad voice"]\n')
        with self.assertRaisesRegex(ValueError, "failed validation"):
            load_measure_lyrics(bad.name)

    def test_prompt_is_unchanged_without_score_context(self) -> None:
        base = build_messages("die-forelle", "2-3", "질문", [])
        same = build_messages("die-forelle", "2-3", "질문", [], score_context="")
        self.assertEqual(base, same)
        block = format_score_context(selected_measure_lyrics(self.lyrics, "die-forelle", [[2, 2]]))
        with_context = build_messages("die-forelle", "2-3", "질문", [], score_context=block)
        self.assertEqual(with_context[0], base[0])
        user = with_context[1]["content"]
        self.assertLess(user.index("Score context"), user.index("Retrieved evidence"))


class DatasetLyricsIntegrationTests(unittest.TestCase):
    def test_real_dataset_lyrics_load(self) -> None:
        root = load_settings()["dataset_root"]
        if not os.path.isfile(os.path.join(root, "sheet_music", "validate_lyrics.py")):
            raise unittest.SkipTest("Dataset lyric transcriptions are not available")
        lyrics = load_measure_lyrics(root)
        self.assertEqual(len(lyrics), 5)
        context = selected_measure_lyrics(lyrics, "die-forelle", [[10, 11]])
        self.assertEqual(context["measures"][0]["measure"], 10)


if __name__ == "__main__":
    unittest.main()
