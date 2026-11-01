"""Render refusal badges in both live and static frontends without a server."""
from pathlib import Path
import shutil
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[2]


@unittest.skipUnless(shutil.which("node"), "Node.js is needed to execute the frontend")
class AnswerStatusTests(unittest.TestCase):
    def test_rejected_answer_is_not_reported_as_missing_evidence(self):
        harness = r"""
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync(process.argv[1], 'utf8');
const functions = source.slice(source.indexOf('function answerWasWithheld('),
                               source.indexOf('async function askQuestion('));
const node = () => ({children: [], appendChild(child) { this.children.push(child); }});
const document = {createElement: node};
let rendered;
const el = {qaHistory: {prepend(item) { rendered = item; }}};
const makeTag = (text, cls) => ({textContent: text, className: cls});
const render = new Function('document', 'state', 'el', 'makeTag',
  functions + '\nreturn renderQAItem;')(document, {pieces: []}, el, makeTag);
const rejected = ['security_policy_violation', 'security_admission_rejected',
  'security_output_rejected', 'security_guard_unavailable',
  'security_guard_invalid_response', 'unsafe_retrieved_evidence',
  'unsafe_score_context', 'unsafe_translation', 'answer_validation_failed',
  'forbidden_internal_metadata', 'prompt_injection_detected',
  'invalid_question', 'question_too_long'];
for (const reason of [...rejected, 'no_corpus_evidence', null, undefined]) {
  const result = {piece_id: 'die-forelle', answer: 'No answer.', evidence: [],
    answer_basis: 'no_corpus_evidence', unavailable_reason: reason};
  render('Question?', result);
  const badge = rendered.children[1].children[0];
  const withheld = rejected.includes(reason);
  assert.equal(badge.textContent, withheld ? 'Answer unavailable' : 'No corpus match', reason);
  assert.equal(badge.className, 'mode-unavailable');
  if (withheld) assert.equal(badge.title, 'Could not produce a verified answer.');
  assert.equal(rendered.children[2].textContent, result.answer);
}
render('Question?', {piece_id: 'die-forelle', answer: 'Grounded answer.', evidence: [],
  answer_basis: 'retrieved_evidence', generation_mode: 'llm'});
assert.equal(rendered.children[1].children[0].textContent, 'LLM · corpus-grounded');
for (const [basis, label] of [
  ['general_music_knowledge', 'General music explanation'],
  ['calculated_music_knowledge', 'General music explanation'],
  ['retrieved_evidence_with_background', 'Sources + general explanation'],
  ['score_context_with_background', 'Lyrics + general explanation']
]) {
  render('Question?', {piece_id: 'die-forelle', answer: 'An explanation.', evidence: [],
    answer_basis: basis, generation_mode: basis === 'calculated_music_knowledge' ? 'llm_guarded_calculation' : 'llm'});
  assert.equal(rendered.children[1].children[0].textContent, label);
}

"""
        for script in (ROOT / "demo/static/app.js", ROOT / "docs/app.js"):
            with self.subTest(script=script):
                subprocess.run(
                    [shutil.which("node"), "-e", harness, str(script)],
                    check=True, capture_output=True, text=True,
                )


if __name__ == "__main__":
    unittest.main()
