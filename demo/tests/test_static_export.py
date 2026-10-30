"""Snapshot provenance describes the saved bytes and the actual request."""
from datetime import datetime
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("snapshot_export", ROOT / "docs/tools/export.py")
export = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(export)


class StaticExportTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.site = Path(temp.name)
        (self.site / "app.js").write_text(
            'const EXAMPLE_QUESTIONS = {\n"die-forelle": [\n'
            '{ text: "What should I practise?", range: [2, 3] },\n'
            '{ text: "What changes?", range: null },\n],\n};\n',
            encoding="utf-8",
        )
        patcher = mock.patch.object(export, "SITE_ROOT", self.site)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_manifest_records_requests_saved_hashes_and_reported_model(self):
        response = {
            "answer": "Keep the phrase connected — 레가토.",
            "pipeline": "soprano_qa", "generation_mode": "llm",
            "answer_basis": "retrieved_evidence",
            "model": {"path": "/private/models/model.gguf", "backend": "llama-cpp-python"},
        }
        with mock.patch.object(export, "fetch", return_value=json.dumps(response).encode()) as fetch:
            export.export_answers("http://example.invalid")
        manifest = json.loads((self.site / "answers/manifest.json").read_text())
        index = json.loads((self.site / "answers/index.json").read_text())
        self.assertEqual(manifest["snapshot_type"], "precomputed_sample_answers")
        self.assertEqual(len(manifest["answers"]), 2)
        self.assertEqual(manifest["exporter_script_sha256"], hashlib.sha256(Path(export.__file__).read_bytes()).hexdigest())
        self.assertIsNotNone(datetime.fromisoformat(manifest["completed_at_utc"]).utcoffset())
        for entry, call, indexed in zip(manifest["answers"], fetch.call_args_list, index["answers"]):
            saved = (self.site / entry["file"]).read_bytes()
            self.assertEqual(entry["sha256"], hashlib.sha256(saved).hexdigest())
            self.assertEqual(entry["request"], json.loads(call.kwargs["data"]))
            self.assertEqual(entry["request"]["language"], "en")
            self.assertEqual(entry["file"], indexed["file"])
            self.assertEqual(entry["server_reported_model"]["path"], "model.gguf")
            self.assertEqual(json.loads(saved)["answer"], response["answer"])
        self.assertNotIn("/private/", (self.site / "answers/manifest.json").read_text())
        self.assertNotIn("server_revision", manifest)

    def test_request_failure_leaves_previous_snapshot_unchanged(self):
        answers = self.site / "answers"
        answers.mkdir()
        previous = answers / "index.json"
        previous.write_text('{"answers": []}\n')
        with mock.patch.object(export, "fetch", side_effect=[b'{"answer": "first"}', SystemExit("failed")]):
            with self.assertRaises(SystemExit):
                export.export_answers("http://example.invalid")
        self.assertEqual(previous.read_text(), '{"answers": []}\n')
        self.assertFalse((answers / "die-forelle/1.json").exists())
        self.assertFalse((answers / "manifest.json").exists())


if __name__ == "__main__":
    unittest.main()
