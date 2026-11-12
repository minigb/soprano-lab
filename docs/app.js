"use strict";

// Highlight the upcoming measure this many seconds before its exact
// timestamp. The audio "timeupdate" event only fires a few times a second,
// so without a lead the visible highlight lags perceptibly behind the audio.
const HIGHLIGHT_LEAD_SECONDS = 0.1;

const state = {
  pieces: [],
  currentPieceId: null,
  currentPiece: null,
  score: null,
  alignment: null,
  measureBoxes: new Map(),
  measureFirstStart: new Map(),
  measureOccurrences: new Map(),
  sortedMeasures: [],
  currentMeasureNumber: null,
  rangeAnchor: null,
  range: null,
  followPlayback: true,
  selectionEndTime: null,
  lang: "en",
  // Answers shown so far, oldest first, so a language switch can relabel them.
  history: [],
  // Whether the live API saves questions and takes feedback (/api/health).
  recordsEnabled: false,
};

const el = {
  tabs: document.getElementById("piece-tabs"),
  scorePages: document.getElementById("score-pages"),
  follow: document.getElementById("follow-playback"),
  resetBtn: document.getElementById("reset-btn"),
  audio: document.getElementById("audio"),
  nowPlayingTitle: document.getElementById("now-playing-title"),
  nowPlayingMeasure: document.getElementById("now-playing-measure"),
  rangeFrom: document.getElementById("range-from"),
  rangeTo: document.getElementById("range-to"),
  rangeClear: document.getElementById("range-clear"),
  playSelection: document.getElementById("play-selection"),
  rangeHint: document.getElementById("range-hint"),
  question: document.getElementById("question"),
  exampleQuestionsWhole: document.getElementById("example-questions-whole"),
  exampleQuestionsRange: document.getElementById("example-questions-range"),
  askBtn: document.getElementById("ask-btn"),
  askStatus: document.getElementById("ask-status"),
  saveNote: document.getElementById("save-note"),
  saveOptOut: document.getElementById("save-optout"),
  qaHistory: document.getElementById("qa-history"),
};

// -- language -------------------------------------------------------------
//
// The page is shown in English or Korean, chosen with the toggle in the top
// bar (or ?lang=en|ko; on a first visit, the browser's language). The choice
// is also the language the live API answers in. Answers already shown keep
// the language they were written in; their labels follow the page.

const LANG_STORAGE_KEY = "soprano-lab-lang";
const PIECE_TITLES = { ko: { "in-flowery-clouds": "꽃구름 속에" } };

const STRINGS = {
  en: {
    languageGroup: "Language",
    scoreHint: "Click a measure to select it, then another to select a range.",
    menuAsk: (p) =>
      p.from === p.to ? `Ask about measure ${p.from}` : `Ask about measures ${p.from}–${p.to}`,
    menuPlayFrom: (p) => `▶ Play from measure ${p.n}`,
    menuExtendHint: "Click another measure to extend the selection.",
    followPlayback: "Follow playback",
    resetTitle: "Clear the measure selection and the question",
    reset: "↺ Reset selection",
    measureRange: "Measure range",
    from: "From",
    to: "To",
    clear: "Clear",
    playSelection: "▶ Play selected measures",
    askHeading: "Ask a question",
    questionScope: "Question scope",
    scopeWhole: "Whole piece",
    scopeRange: "Selected measure range",
    questionPlaceholder: "Write your question here",
    questionPlaceholderSamplesOnly: "Pick a sample question below, then press Ask.",
    sampleQuestions: "Sample questions",
    sampleWhole: "About the whole piece",
    sampleRange: "About a measure range",
    ask: "Ask",
    noteLabel: "About this demo",
    // The model name follows vertex_gemini.model in the RAG repository's
    // config/settings.web.json, which the Cloud Run API is built with.
    noteLive:
      "Answers are written live by Gemini 3.8 Flash from the sources found by the " +
      "paper's measure-aware retrieval.",
    noteEvidence:
      "Expert comments are shown in English translation, with the Korean original " +
      "under each item.",
    footerPaper:
      "Paper: “Soprano Lab: Measure-Aware Question Answering over Expert " +
      "Vocal-Performance Annotations” (ISMIR 2026 Late-Breaking Demo).",
    syncReady: "Score/audio sync ready",
    samplesOnly:
      "This online version answers the sample questions only. Free-form questions " +
      "need the full system, which runs a local LLM.",
    liveUnavailable: "The live model is unavailable right now.",
    liveCouldNotAnswer: "The live model could not answer right now. Please try again in a moment.",
    dailyLimit: "The live demo has reached its daily question limit. Please try again later.",
    shortLimit: "Too many questions in a short time. Please wait a few minutes and try again.",
    noScoreGeometry: "Sheet-music page geometry is not available yet for this piece.",
    measure: (p) => `Measure ${p.n}`,
    measureRepeated: (p) => `Measure ${p.n} (performed ${p.count}×)`,
    occurrenceTitle: (p) => `Measure ${p.n} is performed ${p.count}× — play from:`,
    pass: (p) => `Pass ${p.n}`,
    occurrence: (p) => `Occurrence ${p.n}`,
    rangeSelected: (p) =>
      p.from === p.to ? `Selected measure ${p.from}.` : `Selected measures ${p.from}–${p.to}.`,
    rangeAnchor: (p) =>
      `Selected measure ${p.n}. Click another measure to select a range, or fill in "To".`,
    rangeHelp: "Click measures on the score, or type measure numbers here.",
    measuresUnknown: "Measure numbers are not known yet for this piece.",
    typeQuestionFirst: "Type a question first.",
    selectRangeFirst:
      'Select a measure range first (click two measures in "select range" mode, or use the From/To fields).',
    loadingSaved: "Loading the saved answer…",
    precomputedTitle: "The live model is unavailable.",
    precomputedBody: "This answer was precomputed with Qwen3-14B.",
    saveNote:
      "Questions and answers are saved to improve this demo. Please don't include " +
      "personal information.",
    saveOptOut: "Don't save my questions",
    feedbackPrompt: "Was this answer helpful?",
    feedbackUp: "Helpful",
    feedbackDown: "Not helpful",
    feedbackCommentPlaceholder: "Tell us more (optional)",
    feedbackSend: "Send",
    feedbackThanks: "Thanks for your feedback.",
    feedbackFailed: "Your feedback could not be sent. Please try again.",
    somethingWrong: (p) => `Something went wrong: ${p.message}`,
    thinking: "Thinking…",
    stillThinking:
      "Still thinking… After a quiet spell the first question also starts " +
      "the server, which can take up to a minute.",
    webCoaching: "Web / lesson video (not expert-curated)",
    scoreContextNotice:
      "Answered from the score's lyrics only — no expert annotation covers these measures.",
    sourceLabel: "Source: ",
    lessonVideo: "Lesson video",
    webPage: "Web page",
    sourceFallback: "source",
    lyricsTitle: "Lyrics in the selected measures",
    lyricsNote: "LLM-assisted transcription",
    lyricsBar: (p) => `m. ${p.n}`,
    noVocalStaff: "no vocal staff",
    rest: "rest",
    lyricsTruncated: "Only the first measures of the selection are shown.",
    modelLive: (p) => `Live · ${p.model}`,
    modelSaved: "Precomputed · Qwen3-14B",
    modeExtractive: "Retrieval (extractive)",
    modeInternal: "LLM · internal knowledge",
    modeLlmUnavailable: "LLM unavailable",
    modeScoreOnly: "Score lyrics only",
    modeAnswerUnavailable: "Answer unavailable",
    modeNoMatch: "No corpus match",
    modeGeneral: "General music explanation",
    modeSourcesBackground: "Sources + general explanation",
    modeLyricsBackground: "Lyrics + general explanation",
    modeOutOfScope: "Outside music scope",
    modeSinglePass: "LLM · with sources",
    modeComparison: "Source comparison",
    modeLlm: "LLM · corpus-grounded",
    withheldTitle: "Could not produce a verified answer.",
    pipelineTag: "Soprano QA pipeline",
    tagMeasures: (p) => (p.from === p.to ? `Measure ${p.from}` : `Measures ${p.from}–${p.to}`),
    tagWhole: "Whole piece",
    langEnglish: "English",
    langKorean: "Korean",
    internalCaveat:
      "No matching corpus evidence was used. This answer comes from the local LLM's " +
      "internal knowledge, so score-, edition-, and measure-specific details may be inaccurate.",
    evidence: (p) => `Evidence (${p.n})`,
    kindSumijo: "Professional Soprano",
    kindExpert: "Expert annotation",
    kindWebConditional: "Web reference (conditional rights)",
    kindWeb: "Web reference",
    evidenceMeasures: (p) => ` · measures ${p.list}`,
    evidenceGeneral: " · whole piece / general",
    backgroundOnly: " (background only)",
    showOriginal: "English translation · show the Korean original",
    showTranslation: "Korean original · show the English translation",
    sources: "Sources: ",
    notices: (p) => `Source and rights notices (${p.n})`,
    webEvidence: "web evidence",
    generatedSummary: (p) => ` · generated summary: ${p.license}`,
    generatedAttribution: (p) => `Generated-text attribution: ${p.text}`,
    license: "license",
    terms: "terms",
    sourceTermsApply: "Source terms apply",
  },
  ko: {
    languageGroup: "언어",
    scoreHint: "마디를 누르면 선택되고, 다른 마디를 누르면 범위로 선택됩니다.",
    menuAsk: (p) =>
      p.from === p.to ? `${p.from}마디에 대해 질문하기` : `${p.from}–${p.to}마디에 대해 질문하기`,
    menuPlayFrom: (p) => `▶ ${p.n}마디부터 재생`,
    menuExtendHint: "다른 마디를 누르면 범위로 늘어납니다.",
    followPlayback: "재생 위치 따라가기",
    resetTitle: "마디 선택과 질문을 지웁니다",
    reset: "↺ 선택 초기화",
    measureRange: "마디 범위",
    from: "시작",
    to: "끝",
    clear: "지우기",
    playSelection: "▶ 선택한 마디 재생",
    askHeading: "질문하기",
    questionScope: "질문 범위",
    scopeWhole: "곡 전체",
    scopeRange: "선택한 마디 범위",
    questionPlaceholder: "여기에 질문을 입력하세요",
    questionPlaceholderSamplesOnly: "아래 예시 질문을 고른 뒤 물어보기를 누르세요.",
    sampleQuestions: "예시 질문",
    sampleWhole: "곡 전체에 대한 질문",
    sampleRange: "마디 범위에 대한 질문",
    ask: "물어보기",
    noteLabel: "데모 안내",
    noteLive:
      "답변은 논문의 마디 단위 검색으로 찾은 자료를 바탕으로 Gemini 3.8 Flash가 실시간으로 " +
      "작성합니다.",
    noteEvidence:
      "전문가 근거는 한국어 원문으로 보여 주며, 영어 번역이 있으면 각 항목 아래에서 볼 수 " +
      "있습니다.",
    footerPaper:
      "논문: “Soprano Lab: Measure-Aware Question Answering over Expert " +
      "Vocal-Performance Annotations” (ISMIR 2026 Late-Breaking Demo).",
    syncReady: "악보와 음원 동기화 완료",
    samplesOnly:
      "이 온라인 버전은 예시 질문에만 답합니다. 자유 질문은 로컬 LLM을 실행하는 " +
      "전체 시스템에서 답할 수 있습니다.",
    liveUnavailable: "지금은 실시간 모델을 쓸 수 없습니다.",
    liveCouldNotAnswer: "지금은 실시간 모델이 답하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    dailyLimit: "라이브 데모의 하루 질문 한도에 도달했습니다. 나중에 다시 시도해 주세요.",
    shortLimit: "짧은 시간에 질문이 너무 많았습니다. 몇 분 뒤에 다시 시도해 주세요.",
    noScoreGeometry: "이 곡은 아직 악보 페이지 정보가 없습니다.",
    measure: (p) => `${p.n}마디`,
    measureRepeated: (p) => `${p.n}마디 (${p.count}번 연주)`,
    occurrenceTitle: (p) => `${p.n}마디는 ${p.count}번 연주됩니다. 재생할 위치:`,
    pass: (p) => `${p.n}회차`,
    occurrence: (p) => `${p.n}번째`,
    rangeSelected: (p) =>
      p.from === p.to ? `${p.from}마디를 선택했습니다.` : `${p.from}–${p.to}마디를 선택했습니다.`,
    rangeAnchor: (p) =>
      `${p.n}마디를 선택했습니다. 다른 마디를 누르거나 “끝”을 입력하면 범위가 됩니다.`,
    rangeHelp: "악보에서 마디를 누르거나, 여기에 마디 번호를 입력하세요.",
    measuresUnknown: "이 곡은 아직 마디 번호가 없습니다.",
    typeQuestionFirst: "먼저 질문을 입력하세요.",
    selectRangeFirst:
      "먼저 마디 범위를 선택하세요. “마디를 눌러 범위 선택” 상태에서 마디 두 개를 누르거나 시작/끝 칸에 입력하면 됩니다.",
    loadingSaved: "저장된 답변을 불러오는 중…",
    precomputedTitle: "실시간 모델을 쓸 수 없습니다.",
    precomputedBody: "이 답변은 Qwen3-14B로 미리 만든 답변입니다.",
    saveNote: "질문과 답변은 데모 개선을 위해 저장됩니다. 개인정보는 입력하지 마세요.",
    saveOptOut: "내 질문 저장하지 않기",
    feedbackPrompt: "이 답변이 도움이 되었나요?",
    feedbackUp: "도움이 됨",
    feedbackDown: "도움이 안 됨",
    feedbackCommentPlaceholder: "의견을 남겨 주세요 (선택)",
    feedbackSend: "보내기",
    feedbackThanks: "의견을 보내 주셔서 감사합니다.",
    feedbackFailed: "의견을 보내지 못했습니다. 다시 시도해 주세요.",
    somethingWrong: (p) => `문제가 생겼습니다: ${p.message}`,
    thinking: "답변을 만드는 중…",
    stillThinking:
      "아직 답변을 만드는 중… 한동안 질문이 없었다면 첫 질문이 서버를 깨우느라 " +
      "1분 정도 더 걸릴 수 있습니다.",
    webCoaching: "웹 / 레슨 영상 (전문가 검수 아님)",
    scoreContextNotice: "악보의 가사만으로 답했습니다. 이 마디들을 다룬 전문가 주석은 없습니다.",
    sourceLabel: "출처: ",
    lessonVideo: "레슨 영상",
    webPage: "웹 페이지",
    sourceFallback: "출처",
    lyricsTitle: "선택한 마디의 가사",
    lyricsNote: "LLM 보조 전사",
    lyricsBar: (p) => `${p.n}마디`,
    noVocalStaff: "성악 보표 없음",
    rest: "쉼",
    lyricsTruncated: "선택한 범위의 앞쪽 마디만 보여 줍니다.",
    modelLive: (p) => `실시간 · ${p.model}`,
    modelSaved: "미리 생성 · Qwen3-14B",
    modeExtractive: "검색 (발췌)",
    modeInternal: "LLM · 내부 지식",
    modeLlmUnavailable: "LLM 사용 불가",
    modeScoreOnly: "악보 가사만",
    modeAnswerUnavailable: "답변 불가",
    modeNoMatch: "일치하는 자료 없음",
    modeGeneral: "일반 음악 설명",
    modeSourcesBackground: "자료 + 일반 설명",
    modeLyricsBackground: "가사 + 일반 설명",
    modeOutOfScope: "음악 밖의 질문",
    modeSinglePass: "LLM · 자료 기반",
    modeComparison: "자료 비교",
    modeLlm: "LLM · 자료 근거",
    withheldTitle: "검증된 답변을 만들지 못했습니다.",
    pipelineTag: "Soprano QA 파이프라인",
    tagMeasures: (p) => (p.from === p.to ? `${p.from}마디` : `${p.from}–${p.to}마디`),
    tagWhole: "곡 전체",
    langEnglish: "영어",
    langKorean: "한국어",
    internalCaveat:
      "일치하는 자료를 쓰지 않았습니다. 이 답변은 로컬 LLM의 내부 지식에서 나온 것이라 " +
      "악보, 판본, 마디에 관한 세부 내용이 틀릴 수 있습니다.",
    evidence: (p) => `근거 (${p.n})`,
    kindSumijo: "전문 소프라노",
    kindExpert: "전문가 주석",
    kindWebConditional: "웹 자료 (조건부 이용)",
    kindWeb: "웹 자료",
    evidenceMeasures: (p) => ` · ${p.list}마디`,
    evidenceGeneral: " · 곡 전체 / 일반",
    backgroundOnly: " (배경 자료)",
    showOriginal: "영어 번역 · 한국어 원문 보기",
    showTranslation: "한국어 원문 · 영어 번역 보기",
    sources: "출처: ",
    notices: (p) => `출처 및 권리 고지 (${p.n})`,
    webEvidence: "웹 근거",
    generatedSummary: (p) => ` · 생성 요약: ${p.license}`,
    generatedAttribution: (p) => `생성 텍스트 저작자 표시: ${p.text}`,
    license: "라이선스",
    terms: "이용 약관",
    sourceTermsApply: "원 출처의 이용 조건이 적용됩니다",
  },
};

function t(key, params) {
  const table = STRINGS[state.lang] || STRINGS.en;
  const value = key in table ? table[key] : STRINGS.en[key];
  return typeof value === "function" ? value(params || {}) : value;
}

function initialLanguage() {
  const requested = new URLSearchParams(window.location.search).get("lang");
  if (STRINGS[requested]) return requested;
  try {
    const saved = window.localStorage.getItem(LANG_STORAGE_KEY);
    if (STRINGS[saved]) return saved;
  } catch (_) {
    /* storage unavailable */
  }
  return /^ko\b/i.test(navigator.language || "") ? "ko" : "en";
}

state.lang = initialLanguage();

function pieceTitle(piece) {
  if (!piece) return "";
  return (PIECE_TITLES[state.lang] || {})[piece.id] || piece.title;
}

function applyStaticStrings() {
  document.documentElement.lang = state.lang;
  for (const node of document.querySelectorAll("[data-i18n]")) {
    node.textContent = t(node.dataset.i18n);
  }
  for (const node of document.querySelectorAll("[data-i18n-placeholder]")) {
    node.placeholder = t(node.dataset.i18nPlaceholder);
  }
  for (const node of document.querySelectorAll("[data-i18n-title]")) {
    node.title = t(node.dataset.i18nTitle);
  }
  for (const node of document.querySelectorAll("[data-i18n-aria-label]")) {
    node.setAttribute("aria-label", t(node.dataset.i18nAriaLabel));
  }
  for (const btn of document.querySelectorAll(".lang-btn")) {
    const active = btn.dataset.lang === state.lang;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", String(active));
  }
}

function setLanguage(lang) {
  if (lang === state.lang || !STRINGS[lang]) return;
  // A sample question waiting in the box switches to the new language.
  const waiting = exampleQuestionsFor(state.lang).findIndex(
    (example) => example.text === el.question.value.trim()
  );
  state.lang = lang;
  try {
    window.localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch (_) {
    /* storage unavailable */
  }
  if (waiting >= 0) {
    el.question.value = exampleQuestionsFor(lang)[waiting].text;
  }
  applyStaticStrings();
  closeScoreMenu();
  if (state.currentPiece) {
    renderPieceTabs();
    el.nowPlayingTitle.textContent = pieceTitle(state.currentPiece);
    el.nowPlayingMeasure.textContent =
      state.currentMeasureNumber != null ? t("measure", { n: state.currentMeasureNumber }) : "";
    updateMeasureTitles();
    updateRangeInputsFromState();
    renderExampleQuestions();
  }
  if (!el.askBtn.disabled) el.askStatus.textContent = "";
  renderHistory();
}

for (const btn of document.querySelectorAll(".lang-btn")) {
  btn.addEventListener("click", () => setLanguage(btn.dataset.lang));
}

// Static snapshot: every data URL is relative to the page, so the site works
// under a path prefix such as /soprano-lab/. API GETs map to "<path>.json".
const DATA_BASE = "";

// Live answers come from the Soprano Lab API (demo/server.py with the Gemini
// backend) named in index.html's <meta name="soprano-lab-api">. Without it,
// or while the API is unavailable, the sample questions fall back to the
// answers precomputed with the paper's local Qwen3-14B pipeline.
const API_BASE = (
  (document.querySelector('meta[name="soprano-lab-api"]') || {}).content || ""
)
  .trim()
  .replace(/\/+$/, "");
const SLOW_ANSWER_NOTICE_MS = 10000;

function dataUrl(path) {
  return DATA_BASE + path.replace(/^\//, "");
}

function apiUrl(path) {
  return dataUrl(path) + ".json";
}

// play() returns a promise that rejects with AbortError when playback is
// interrupted on purpose (pause, a new source on tab switch); only report
// other failures.
function playAudio() {
  const started = el.audio.play();
  if (started && started.catch) {
    started.catch((err) => {
      if (err.name !== "AbortError") console.error(err);
    });
  }
}

async function fetchJSON(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = await res.json();
      msg = j.error || msg;
    } catch (_) {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json();
}

function formatRangeList(ranges) {
  return ranges
    .map((r) => (r[0] === r[1] ? String(r[0]) : `${r[0]}-${r[1]}`))
    .join(", ");
}

// -- piece selection ---------------------------------------------------

async function loadPieces() {
  const data = await fetchJSON(apiUrl("/api/pieces"));
  state.pieces = data.pieces;
  renderPieceTabs();
  const preferred = state.pieces.find((p) => p.sync_available) || state.pieces[0];
  await selectPiece(preferred.id);
}

function renderPieceTabs() {
  el.tabs.innerHTML = "";
  for (const p of state.pieces) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "piece-tab" +
      (p.id === state.currentPieceId ? " active" : "") +
      (p.pending_reason ? " pending" : "");
    const dot = document.createElement("span");
    dot.className = "dot";
    btn.appendChild(dot);
    btn.appendChild(document.createTextNode(pieceTitle(p)));
    btn.title = p.pending_reason || t("syncReady");
    btn.addEventListener("click", () => selectPiece(p.id));
    el.tabs.appendChild(btn);
  }
}

async function selectPiece(pieceId) {
  state.currentPieceId = pieceId;
  state.currentPiece = state.pieces.find((p) => p.id === pieceId);
  state.range = null;
  state.rangeAnchor = null;
  state.currentMeasureNumber = null;
  state.selectionEndTime = null;
  closeScoreMenu();

  renderPieceTabs();

  el.nowPlayingTitle.textContent = pieceTitle(state.currentPiece);
  el.nowPlayingMeasure.textContent = "";
  el.audio.pause();
  el.audio.src = dataUrl(`/media/audio/${pieceId}.mp3`);


  const [score, alignment] = await Promise.all([
    fetchJSON(apiUrl(`/api/pieces/${pieceId}/score`)).catch(() => null),
    fetchJSON(apiUrl(`/api/pieces/${pieceId}/alignment`)),
  ]);
  state.score = score;
  state.alignment = alignment;
  state.sortedMeasures = (alignment.measures || [])
    .slice()
    .sort((a, b) => a.start_seconds - b.start_seconds);
  state.measureFirstStart = new Map();
  state.measureOccurrences = new Map();
  for (const m of state.sortedMeasures) {
    if (!state.measureFirstStart.has(m.measure_number)) {
      state.measureFirstStart.set(m.measure_number, m.start_seconds);
    }
    if (!state.measureOccurrences.has(m.measure_number)) {
      state.measureOccurrences.set(m.measure_number, []);
    }
    state.measureOccurrences.get(m.measure_number).push(m);
  }

  renderScorePages();
  renderExampleQuestions();
  el.rangeFrom.max = state.currentPiece.max_measure_number || "";
  el.rangeTo.max = state.currentPiece.max_measure_number || "";
  updateRangeInputsFromState();
}

// -- score rendering -----------------------------------------------------

function renderScorePages() {
  el.scorePages.innerHTML = "";
  state.measureBoxes = new Map();

  if (!state.score) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = t("noScoreGeometry");
    el.scorePages.appendChild(p);
    return;
  }

  for (const page of state.score.pages) {
    const pageEl = document.createElement("div");
    pageEl.className = "score-page";

    const img = document.createElement("img");
    img.src = dataUrl(page.image_url);
    // Reserve the page's height before the (multi-MB) image arrives, so the
    // measure overlay is laid out correctly on a slow connection.
    img.width = page.image_width;
    img.height = page.image_height;
    img.alt = page.page_id;
    img.loading = "lazy";
    pageEl.appendChild(img);

    const overlay = document.createElement("div");
    overlay.className = "measure-overlay";
    for (const row of page.rows) {
      for (const m of row.measures) {
        const occurrences = state.measureOccurrences.get(m.measure_number) || [];
        const repeats = occurrences.length > 1;
        const box = document.createElement("div");
        box.className =
          "measure-box" +
          (state.currentPiece.sync_available ? "" : " no-sync") +
          (repeats ? " has-repeats" : "");
        box.dataset.measureNumber = String(m.measure_number);
        const b = m.bbox_normalized;
        box.style.left = b.x * 100 + "%";
        box.style.top = b.y * 100 + "%";
        box.style.width = b.width * 100 + "%";
        box.style.height = b.height * 100 + "%";
        box.title = measureTitle(m.measure_number);
        overlay.appendChild(box);
        state.measureBoxes.set(m.measure_number, box);
      }
    }
    pageEl.appendChild(overlay);
    el.scorePages.appendChild(pageEl);
  }

  updateCurrentHighlight();
  updateRangeHighlight();
}

function measureTitle(measureNumber) {
  const count = (state.measureOccurrences.get(measureNumber) || []).length;
  return count > 1
    ? t("measureRepeated", { n: measureNumber, count })
    : t("measure", { n: measureNumber });
}

function updateMeasureTitles() {
  for (const [num, box] of state.measureBoxes) {
    box.title = measureTitle(num);
  }
}

// Clicking the score selects measures; it never starts playback by itself.
// The first click selects one measure (already a range a question can use),
// a click on another measure extends it to a range, and the next click starts
// a new selection. Shift-click extends the current range. A menu beside the
// clicked measure then offers to ask about the selection or to play from it.
el.scorePages.addEventListener("click", (e) => {
  const box = e.target.closest(".measure-box");
  if (!box || !state.currentPiece || !state.currentPiece.measures_known) return;
  handleMeasureClick(parseInt(box.dataset.measureNumber, 10), e.shiftKey);
  openSelectionMenu(box);
});

el.scorePages.addEventListener("scroll", closeScoreMenu);
window.addEventListener("resize", closeScoreMenu);

// -- menus on the score ------------------------------------------------------
//
// One small menu at a time, below the measure it belongs to (above it near
// the bottom of the window): the selection menu, or the list of a repeated
// measure's performances to play from. Escape or a click elsewhere closes it.

let scoreMenuEl = null;
let scoreMenuOutsideHandler = null;

function closeScoreMenu() {
  if (scoreMenuEl) {
    scoreMenuEl.remove();
    scoreMenuEl = null;
  }
  if (scoreMenuOutsideHandler) {
    document.removeEventListener("click", scoreMenuOutsideHandler);
    document.removeEventListener("keydown", scoreMenuOutsideHandler);
    scoreMenuOutsideHandler = null;
  }
}

function openScoreMenu(box, menu) {
  closeScoreMenu();
  document.body.appendChild(menu);
  const rect = box.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const viewWidth = document.documentElement.clientWidth;
  const viewHeight = document.documentElement.clientHeight;
  let left = rect.left;
  if (left + menuRect.width > viewWidth - 8) left = Math.max(8, viewWidth - menuRect.width - 8);
  let top = rect.bottom + 6;
  if (top + menuRect.height > viewHeight - 8 && rect.top - menuRect.height - 6 > 8) {
    top = rect.top - menuRect.height - 6;
  }
  menu.style.left = `${left + window.scrollX}px`;
  menu.style.top = `${top + window.scrollY}px`;
  scoreMenuEl = menu;

  scoreMenuOutsideHandler = (e) => {
    if (e.type === "keydown") {
      if (e.key === "Escape") closeScoreMenu();
      return;
    }
    // A click on another measure opens that measure's menu instead.
    if (scoreMenuEl && !scoreMenuEl.contains(e.target) && !e.target.closest(".measure-box")) {
      closeScoreMenu();
    }
  };
  // Deferred so the click that opened the menu doesn't immediately close it
  // once it bubbles up to document.
  setTimeout(() => {
    document.addEventListener("click", scoreMenuOutsideHandler);
    document.addEventListener("keydown", scoreMenuOutsideHandler);
  }, 0);
}

function menuButton(text, className, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = className;
  btn.textContent = text;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return btn;
}

function openSelectionMenu(box) {
  if (!state.range) {
    closeScoreMenu();
    return;
  }
  const [from, to] = state.range;
  const menu = document.createElement("div");
  menu.className = "score-menu selection-menu";
  menu.setAttribute("role", "dialog");
  menu.setAttribute("aria-label", t("tagMeasures", { from, to }));

  const head = document.createElement("div");
  head.className = "score-menu-title";
  head.textContent = t("tagMeasures", { from, to });
  menu.appendChild(head);

  menu.appendChild(
    menuButton(t("menuAsk", { from, to }), "score-menu-primary", () => {
      closeScoreMenu();
      el.question.focus();
    })
  );
  // Playback runs on from the selection's first measure; the side card's
  // "Play selected measures" plays only the selection.
  if (state.currentPiece.sync_available) {
    menu.appendChild(
      menuButton(t("menuPlayFrom", { n: from }), "score-menu-secondary", () => {
        const startBox = state.measureBoxes.get(from) || box;
        const occurrences = state.measureOccurrences.get(from) || [];
        if (occurrences.length > 1) {
          openOccurrenceMenu(startBox, from, occurrences);
        } else {
          closeScoreMenu();
          seekToMeasure(from);
        }
      })
    );
  }
  if (state.rangeAnchor != null) {
    const hint = document.createElement("div");
    hint.className = "score-menu-hint";
    hint.textContent = t("menuExtendHint");
    menu.appendChild(hint);
  }
  openScoreMenu(box, menu);
}

// A measure number can be performed more than once (a written repeat, e.g.
// Die Forelle replays several measures for its second verse). Playing from
// such a measure asks which performance to start from, instead of silently
// always jumping to the first.
function formatClockTime(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function openOccurrenceMenu(box, measureNumber, occurrences) {
  const menu = document.createElement("div");
  menu.className = "score-menu occurrence-menu";

  const title = document.createElement("div");
  title.className = "score-menu-title";
  title.textContent = t("occurrenceTitle", { n: measureNumber, count: occurrences.length });
  menu.appendChild(title);

  occurrences.forEach((occ, i) => {
    const label =
      occ.repeat_pass != null ? t("pass", { n: occ.repeat_pass }) : t("occurrence", { n: i + 1 });
    menu.appendChild(
      menuButton(`${label} — ${formatClockTime(occ.start_seconds)}`, "score-menu-item", () => {
        state.selectionEndTime = null;
        el.audio.currentTime = occ.start_seconds;
        playAudio();
        closeScoreMenu();
      })
    );
  });
  openScoreMenu(box, menu);
}

// -- playback sync ---------------------------------------------------------

function findMeasureAtTime(measures, t) {
  let lo = 0,
    hi = measures.length - 1,
    ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (measures[mid].start_seconds <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans === -1 ? null : measures[ans];
}

el.audio.addEventListener("timeupdate", () => {
  if (state.selectionEndTime != null && el.audio.currentTime >= state.selectionEndTime) {
    el.audio.pause();
    state.selectionEndTime = null;
  }

  if (!state.currentPiece || !state.currentPiece.sync_available || !state.sortedMeasures.length) {
    return;
  }
  // Look slightly ahead of the raw playback position so the highlight lands
  // on the new measure right as it starts, instead of visibly lagging behind
  // it (timeupdate only fires a few times a second).
  const lookaheadTime = el.audio.currentTime + HIGHLIGHT_LEAD_SECONDS;
  const m = findMeasureAtTime(state.sortedMeasures, lookaheadTime);
  const num = m ? m.measure_number : null;
  if (num !== state.currentMeasureNumber) {
    state.currentMeasureNumber = num;
    updateCurrentHighlight();
    el.nowPlayingMeasure.textContent = num != null ? t("measure", { n: num }) : "";
    if (state.followPlayback && num != null) {
      const box = state.measureBoxes.get(num);
      if (box) box.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    }
  }
});

function seekToMeasure(measureNumber) {
  const t = state.measureFirstStart.get(measureNumber);
  if (t == null) return;
  state.selectionEndTime = null;
  el.audio.currentTime = t;
  playAudio();
}

// Find the [start, end) audio window covering an inclusive measure range,
// using the first performed occurrence of the start measure and the nearest
// following occurrence of the end measure (falling back to its last
// occurrence if none follows, e.g. when the range is a single repeated bar).
function getRangeAudioWindow(startMeasure, endMeasure) {
  const startTime = state.measureFirstStart.get(startMeasure);
  if (startTime == null) return null;
  let endTime = null;
  for (const m of state.sortedMeasures) {
    if (m.measure_number === endMeasure && m.start_seconds >= startTime) {
      endTime = m.end_seconds;
      break;
    }
  }
  if (endTime == null) {
    for (let i = state.sortedMeasures.length - 1; i >= 0; i--) {
      if (state.sortedMeasures[i].measure_number === endMeasure) {
        endTime = state.sortedMeasures[i].end_seconds;
        break;
      }
    }
  }
  return endTime != null && endTime > startTime ? { startTime, endTime } : null;
}

function playSelection() {
  if (!state.range || !state.currentPiece || !state.currentPiece.sync_available) return;
  const audioWindow = getRangeAudioWindow(state.range[0], state.range[1]);
  if (!audioWindow) return;
  state.selectionEndTime = audioWindow.endTime;
  el.audio.currentTime = audioWindow.startTime;
  playAudio();
}

function updatePlaySelectionButton() {
  el.playSelection.disabled = !(
    state.range &&
    state.currentPiece &&
    state.currentPiece.sync_available
  );
}

el.playSelection.addEventListener("click", playSelection);

function updateCurrentHighlight() {
  for (const [num, box] of state.measureBoxes) {
    box.classList.toggle("current", num === state.currentMeasureNumber);
  }
}

// -- range selection ---------------------------------------------------

function handleMeasureClick(measureNumber, extend) {
  if (extend && state.range) {
    state.range = [Math.min(state.range[0], measureNumber), Math.max(state.range[1], measureNumber)];
    state.rangeAnchor = null;
  } else if (state.rangeAnchor === null || state.rangeAnchor === measureNumber) {
    // A new selection; a second click on its first measure keeps it single.
    const fresh = state.rangeAnchor === null;
    state.range = [measureNumber, measureNumber];
    state.rangeAnchor = fresh ? measureNumber : null;
  } else {
    const a = state.rangeAnchor;
    state.range = [Math.min(a, measureNumber), Math.max(a, measureNumber)];
    state.rangeAnchor = null;
  }
  const scopeRange = document.querySelector('input[name="scope"][value="range"]');
  if (scopeRange) scopeRange.checked = true;
  updateRangeInputsFromState();
  updateRangeHighlight();
}

function updateRangeHighlight() {
  for (const [num, box] of state.measureBoxes) {
    box.classList.remove("in-range", "anchor");
    if (state.rangeAnchor === num) {
      box.classList.add("anchor");
    } else if (state.range && num >= state.range[0] && num <= state.range[1]) {
      box.classList.add("in-range");
    }
  }
}

function updateRangeInputsFromState() {
  if (state.range) {
    el.rangeFrom.value = state.range[0];
    el.rangeTo.value = state.range[1];
    el.rangeHint.textContent =
      state.rangeAnchor != null
        ? t("rangeAnchor", { n: state.rangeAnchor })
        : t("rangeSelected", { from: state.range[0], to: state.range[1] });
  } else {
    el.rangeFrom.value = "";
    el.rangeTo.value = "";
    el.rangeHint.textContent = state.currentPiece && state.currentPiece.measures_known
      ? t("rangeHelp")
      : t("measuresUnknown");
  }
  updatePlaySelectionButton();
}

function onRangeInputsChanged() {
  const from = parseInt(el.rangeFrom.value, 10);
  const to = parseInt(el.rangeTo.value, 10);
  if (Number.isFinite(from) && Number.isFinite(to) && from > 0 && to > 0) {
    state.range = [Math.min(from, to), Math.max(from, to)];
    state.rangeAnchor = null;
    updateRangeInputsFromState();
    updateRangeHighlight();
    const scopeRange = document.querySelector('input[name="scope"][value="range"]');
    if (scopeRange) scopeRange.checked = true;
  }
}
el.rangeFrom.addEventListener("change", onRangeInputsChanged);
el.rangeTo.addEventListener("change", onRangeInputsChanged);

el.rangeClear.addEventListener("click", () => {
  state.range = null;
  state.rangeAnchor = null;
  updateRangeInputsFromState();
  updateRangeHighlight();
});

// -- follow toggle and reset ---------------------------------------------

el.follow.addEventListener("change", () => {
  state.followPlayback = el.follow.checked;
});

function resetSelection() {
  state.range = null;
  state.rangeAnchor = null;
  state.selectionEndTime = null;
  updateRangeInputsFromState();
  updateRangeHighlight();
  closeScoreMenu();

  const scopeWhole = document.querySelector('input[name="scope"][value="whole"]');
  if (scopeWhole) scopeWhole.checked = true;

  el.question.value = "";
  el.askStatus.textContent = "";
}

el.resetBtn.addEventListener("click", resetSelection);

// -- ask the RAG system ---------------------------------------------------

function makeTag(text, cls) {
  const span = document.createElement("span");
  span.className = "tag " + cls;
  span.textContent = text;
  return span;
}

function makeLink(url, text) {
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = text;
  return link;
}

// Parse the start of a locator such as "[12:01-12:20]" or "[1:02:03-1:02:30]"
// into seconds. Returns null when the locator has no leading timestamp.
function locatorStartSeconds(locator) {
  if (typeof locator !== "string") return null;
  const m = locator.match(/^\s*\[?\s*(\d+(?::\d{1,2}){1,2})/);
  if (!m) return null;
  return m[1].split(":").reduce((total, part) => total * 60 + parseInt(part, 10), 0);
}

function isYouTubeUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\.|^m\./, "");
    return host === "youtube.com" || host === "youtu.be" || host === "music.youtube.com";
  } catch (_) {
    return false;
  }
}

// Link to a web-coaching source; YouTube videos jump to the cited timestamp.
function webCoachingSourceUrl(source) {
  if (!source || !source.url) return null;
  const seconds = locatorStartSeconds(source.locator);
  if (source.kind !== "video" || seconds == null || !isYouTubeUrl(source.url)) {
    return source.url;
  }
  try {
    const url = new URL(source.url);
    url.searchParams.set("t", String(seconds));
    return url.toString();
  } catch (_) {
    return source.url;
  }
}

function appendWebCoachingSources(container, sources) {
  container.appendChild(document.createTextNode(t("sourceLabel")));
  sources.forEach((source, index) => {
    if (index) container.appendChild(document.createTextNode(" · "));
    const kind = source.kind === "video" ? t("lessonVideo") : t("webPage");
    const title = source.title || source.url || source.web_coaching_source_id || t("sourceFallback");
    const href = webCoachingSourceUrl(source);
    container.appendChild(document.createTextNode(`${kind}: `));
    container.appendChild(href ? makeLink(href, title) : document.createTextNode(title));
    const extras = [source.author, source.locator].filter(Boolean);
    if (extras.length) {
      container.appendChild(document.createTextNode(` (${extras.join(", ")})`));
    }
  });
}

function renderScoreContext(scoreContext) {
  const box = document.createElement("div");
  box.className = "lyrics-box";

  const head = document.createElement("div");
  head.className = "lyrics-head";
  const title = document.createElement("strong");
  title.textContent = t("lyricsTitle");
  head.appendChild(title);
  const note = document.createElement("span");
  note.className = "lyrics-note";
  note.textContent = t("lyricsNote");
  head.appendChild(note);
  box.appendChild(head);

  // Line labels can be long ("upper printed verse line (stanza 1 ...)"), so
  // show them once as numbered captions and tag each lyric line by number.
  const labels = scoreContext.line_labels || [];
  const numberLines = labels.length > 1;
  if (labels.length) {
    const legend = document.createElement("div");
    legend.className = "lyrics-legend";
    labels.forEach((label, index) => {
      const caption = document.createElement("div");
      caption.textContent = numberLines ? `${index + 1} = ${label}` : label;
      legend.appendChild(caption);
    });
    box.appendChild(legend);
  }
  const table = document.createElement("div");
  table.className = "lyrics-rows";
  for (const m of scoreContext.measures || []) {
    const row = document.createElement("div");
    row.className = "lyrics-row";
    const bar = document.createElement("span");
    bar.className = "lyrics-bar";
    bar.textContent = t("lyricsBar", { n: m.measure });
    row.appendChild(bar);

    const lines = document.createElement("div");
    lines.className = "lyrics-lines";
    const lyricLines = m.lyric_lines || [];
    if (m.voice !== "sung" || !lyricLines.some((line) => line)) {
      const rest = document.createElement("span");
      rest.className = "lyrics-empty";
      rest.textContent =
        m.voice === "no_voice_staff" ? t("noVocalStaff") : m.voice === "rest" ? t("rest") : "—";
      lines.appendChild(rest);
    } else {
      lyricLines.forEach((text, index) => {
        if (!text) return;
        const line = document.createElement("div");
        line.className = "lyrics-line";
        if (numberLines) {
          const caption = document.createElement("span");
          caption.className = "lyrics-label";
          caption.textContent = String(index + 1);
          caption.title = labels[index] || "";
          line.appendChild(caption);
        }
        line.appendChild(document.createTextNode(text));
        lines.appendChild(line);
      });
    }
    row.appendChild(lines);
    table.appendChild(row);
  }
  box.appendChild(table);

  if (scoreContext.truncated) {
    const more = document.createElement("div");
    more.className = "lyrics-note";
    more.textContent = t("lyricsTruncated");
    box.appendChild(more);
  }
  return box;
}

function answerWasWithheld(result) {
  const reason = result.unavailable_reason || "";
  return result.answer_basis === "no_corpus_evidence" && (
    reason.startsWith("security_") ||
    reason.startsWith("unsafe_") ||
    ["answer_validation_failed", "forbidden_internal_metadata",
      "prompt_injection_detected", "invalid_question", "question_too_long"].includes(reason)
  );
}

// Which model wrote the answer: the live API reports its model, and saved
// answers were made with the paper's local Qwen3-14B.
function answerModelTag(result) {
  const model = result.model || {};
  if (model.backend === "vertex_gemini" && model.model) {
    return makeTag(t("modelLive", { model: model.model }), "model-live");
  }
  if (result.precomputed) {
    return makeTag(t("modelSaved"), "model-saved");
  }
  return null;
}

function addQAItem(question, result) {
  const entry = { question, result, feedback: { rating: null, draft: "" } };
  state.history.push(entry);
  renderQAItem(entry);
  // The newest answer is on top of the history, below the question card.
  el.qaHistory.firstElementChild.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderHistory() {
  el.qaHistory.innerHTML = "";
  for (const entry of state.history) {
    renderQAItem(entry);
  }
}

// Answers are plain text, but the models mark titles and stress Markdown-style:
// *italic* and **bold**, and sometimes "* " bullets. Those are shown as
// emphasis and "• "; everything else stays text (no HTML is parsed). Line
// breaks are kept by .qa-answer's white-space.
const EMPHASIS_RE = /\*\*(\S(?:[^*\n]*\S)?)\*\*|\*(\S(?:[^*\n]*\S)?)\*/g;

function appendAnswerText(container, text) {
  const value = String(text || "").replace(/^([ \t]*)\* /gm, "$1• ");
  let last = 0;
  for (const match of value.matchAll(EMPHASIS_RE)) {
    container.append(value.slice(last, match.index));
    const node = document.createElement(match[1] !== undefined ? "strong" : "em");
    node.textContent = match[1] !== undefined ? match[1] : match[2];
    container.append(node);
    last = match.index + match[0].length;
  }
  container.append(value.slice(last));
}

function renderQAItem(entry) {
  const { question, result } = entry;
  const item = document.createElement("div");
  item.className = "qa-item";

  const q = document.createElement("div");
  q.className = "qa-question";
  q.textContent = question;
  item.appendChild(q);

  const meta = document.createElement("div");
  meta.className = "qa-meta";
  const usesInternalKnowledge = result.answer_basis === "internal_knowledge";
  const generationUnavailable = result.answer_basis === "generation_unavailable";
  const noCorpusEvidence = result.answer_basis === "no_corpus_evidence";
  const answerWithheld = answerWasWithheld(result);
  const scoreContextOnly = result.answer_basis === "score_context";
  let modeLabel = t("modeExtractive");
  let modeClass = "mode-extractive";
  if (usesInternalKnowledge) {
    modeLabel = t("modeInternal");
    modeClass = "mode-internal";
  } else if (generationUnavailable) {
    modeLabel = t("modeLlmUnavailable");
    modeClass = "mode-unavailable";
  } else if (scoreContextOnly) {
    modeLabel = t("modeScoreOnly");
    modeClass = "mode-score";
  } else if (noCorpusEvidence) {
    modeLabel = answerWithheld ? t("modeAnswerUnavailable") : t("modeNoMatch");
    modeClass = "mode-unavailable";
  } else if (["general_music_knowledge", "calculated_music_knowledge"].includes(result.answer_basis)) {
    modeLabel = t("modeGeneral");
    modeClass = "mode-llm";
  } else if (result.answer_basis === "retrieved_evidence_with_background") {
    modeLabel = t("modeSourcesBackground");
    modeClass = "mode-llm";
  } else if (result.answer_basis === "score_context_with_background") {
    modeLabel = t("modeLyricsBackground");
    modeClass = "mode-llm";
  } else if (result.answer_basis === "service_scope") {
    // Single-pass writer: the question was outside singing and music.
    modeLabel = t("modeOutOfScope");
    modeClass = "mode-unavailable";
  } else if (result.answer_basis === "service_status") {
    // Single-pass writer: the model returned no usable text.
    modeLabel = t("modeAnswerUnavailable");
    modeClass = "mode-unavailable";
  } else if (result.generation_mode === "llm_single_pass") {
    // One answer call over the retrieved sources, without the reviewed
    // pipeline's separate answer checks.
    modeLabel = t("modeSinglePass");
    modeClass = "mode-llm";
  } else if (result.generation_mode === "llm_guarded_source_comparison") {
    modeLabel = t("modeComparison");
    modeClass = "mode-llm";
  } else if (result.generation_mode === "llm") {
    modeLabel = t("modeLlm");
    modeClass = "mode-llm";
  }
  const modeTag = makeTag(
    modeLabel,
    modeClass
  );
  if (answerWithheld) {
    modeTag.title = t("withheldTitle");
  } else if (result.generation_fallback_reason) {
    modeTag.title = result.generation_fallback_reason;
  }
  meta.appendChild(modeTag);
  meta.appendChild(makeTag(t("pipelineTag"), "pipeline"));
  const modelTag = answerModelTag(result);
  if (modelTag) {
    meta.appendChild(modelTag);
  }
  const answerPiece = state.pieces.find((piece) => piece.id === result.piece_id);
  meta.appendChild(
    makeTag(answerPiece ? pieceTitle(answerPiece) : result.piece_id, "answer-piece")
  );
  if (result.scope === "range") {
    meta.appendChild(
      makeTag(
        t("tagMeasures", { from: result.measure_range[0], to: result.measure_range[1] }),
        "scope-range"
      )
    );
  } else {
    meta.appendChild(makeTag(t("tagWhole"), "scope-whole"));
  }
  if (result.language) {
    meta.appendChild(
      makeTag(result.language === "en" ? t("langEnglish") : t("langKorean"), "language")
    );
  }
  item.appendChild(meta);

  if (scoreContextOnly) {
    const badge = document.createElement("div");
    badge.className = "qa-caveat qa-score-only";
    badge.textContent = t("scoreContextNotice");
    item.appendChild(badge);
  }

  if (result.precomputed) {
    const notice = document.createElement("div");
    notice.className = "qa-caveat qa-precomputed";
    notice.setAttribute("role", "note");
    const title = document.createElement("strong");
    title.textContent = t("precomputedTitle");
    notice.append(title, " ", t("precomputedBody"));
    item.appendChild(notice);
  }

  const ans = document.createElement("div");
  ans.className = "qa-answer";
  appendAnswerText(ans, result.answer);
  item.appendChild(ans);

  if (usesInternalKnowledge) {
    const caveat = document.createElement("div");
    caveat.className = "qa-caveat";
    caveat.textContent = t("internalCaveat");
    item.appendChild(caveat);
  }

  if (result.score_context && (result.score_context.measures || []).length) {
    item.appendChild(renderScoreContext(result.score_context));
  }

  const notices = result.evidence_notices || [];
  const noticeById = new Map(notices.map((notice) => [notice.record_id, notice]));

  const details = document.createElement("details");
  details.className = "qa-evidence";
  const summary = document.createElement("summary");
  summary.textContent = t("evidence", { n: result.evidence.length });
  details.appendChild(summary);
  for (const ev of result.evidence) {
    const evEl = document.createElement("div");
    evEl.className = "evidence-item" + (ev.in_requested_scope ? "" : " out-of-scope");
    const metaLine = document.createElement("div");
    metaLine.className = "evidence-meta";
    const isWebCoaching = ev.evidence_type === "web_coaching";
    if (isWebCoaching) evEl.classList.add("web-coaching");
    const kindLabel =
      ev.kind === "sumijo"
        ? t("kindSumijo")
        : ev.kind === "expert"
        ? t("kindExpert")
        : isWebCoaching
        ? t("webCoaching")
        : ev.usage_class === "research_conditional"
        ? t("kindWebConditional")
        : t("kindWeb");
    const rangeLabel = ev.is_local
      ? t("evidenceMeasures", { list: formatRangeList(ev.measure_ranges) })
      : t("evidenceGeneral");
    metaLine.textContent =
      `[${ev.id}] · ${kindLabel}${rangeLabel}` +
      (ev.in_requested_scope ? "" : t("backgroundOnly"));
    evEl.appendChild(metaLine);
    // The evidence is Korean; English answers also carry an English
    // translation (text_en). Show the page language first, the other below.
    const translated = Boolean(ev.text_en);
    const translationFirst = translated && state.lang === "en";
    const textEl = document.createElement("div");
    textEl.lang = translationFirst ? "en" : "ko";
    textEl.textContent = translationFirst ? ev.text_en : ev.text;
    evEl.appendChild(textEl);
    if (translated) {
      const other = document.createElement("details");
      other.className = "evidence-original";
      const otherSummary = document.createElement("summary");
      otherSummary.textContent = translationFirst ? t("showOriginal") : t("showTranslation");
      other.appendChild(otherSummary);
      const otherText = document.createElement("div");
      otherText.lang = translationFirst ? "ko" : "en";
      otherText.textContent = translationFirst ? ev.text : ev.text_en;
      other.appendChild(otherText);
      evEl.appendChild(other);
    }
    if (ev.sources && ev.sources.length) {
      const sourceLine = document.createElement("div");
      sourceLine.className = "evidence-sources";
      sourceLine.appendChild(document.createTextNode(t("sources")));
      ev.sources.forEach((source, index) => {
        if (index) sourceLine.appendChild(document.createTextNode(" · "));
        const link = document.createElement("a");
        link.href = source.url;
        link.target = "_blank";
        link.rel = "noreferrer";
        link.textContent = source.title || source.web_source_id;
        sourceLine.appendChild(link);
      });
      evEl.appendChild(sourceLine);
    } else if (isWebCoaching) {
      const notice = noticeById.get(ev.id);
      if (notice && notice.sources && notice.sources.length) {
        const sourceLine = document.createElement("div");
        sourceLine.className = "evidence-sources";
        appendWebCoachingSources(sourceLine, notice.sources);
        evEl.appendChild(sourceLine);
      }
    }
    details.appendChild(evEl);
  }
  item.appendChild(details);

  if (notices.length) {
    const noticeDetails = document.createElement("details");
    noticeDetails.className = "qa-evidence qa-notices";
    const noticeSummary = document.createElement("summary");
    noticeSummary.textContent = t("notices", { n: notices.length });
    noticeDetails.appendChild(noticeSummary);
    for (const notice of notices) {
      const noticeEl = document.createElement("div");
      noticeEl.className = "evidence-item";
      const noticeMeta = document.createElement("div");
      noticeMeta.className = "evidence-meta";
      const noticeIsWebCoaching = (notice.sources || []).some(
        (source) => source.web_coaching_source_id || source.kind === "video" || source.kind === "web_page"
      );
      if (noticeIsWebCoaching) {
        noticeMeta.textContent = `[${notice.record_id}] · ${t("webCoaching")}`;
        noticeEl.appendChild(noticeMeta);
        const sourceLine = document.createElement("div");
        sourceLine.className = "rights-condition";
        appendWebCoachingSources(sourceLine, notice.sources);
        noticeEl.appendChild(sourceLine);
        noticeDetails.appendChild(noticeEl);
        continue;
      }
      noticeMeta.textContent =
        `[${notice.record_id}] · ${notice.usage_class || t("webEvidence")}` +
        (notice.generated_text_license
          ? t("generatedSummary", { license: notice.generated_text_license })
          : "");
      noticeEl.appendChild(noticeMeta);

      if (notice.generated_text_attribution) {
        const projectCredit = document.createElement("div");
        projectCredit.className = "rights-condition";
        projectCredit.appendChild(
          document.createTextNode(
            t("generatedAttribution", { text: notice.generated_text_attribution })
          )
        );
        if (notice.generated_text_license_url) {
          projectCredit.appendChild(document.createTextNode(" · "));
          const licenseLink = document.createElement("a");
          licenseLink.href = notice.generated_text_license_url;
          licenseLink.target = "_blank";
          licenseLink.rel = "noreferrer";
          licenseLink.textContent = t("license");
          projectCredit.appendChild(licenseLink);
        }
        noticeEl.appendChild(projectCredit);
      }

      for (const inherited of notice.inherited_licenses || []) {
        const condition = document.createElement("div");
        condition.className = "rights-condition";
        condition.appendChild(document.createTextNode(
          `${inherited.attribution || t("sourceTermsApply")}` +
          (inherited.license_id ? ` · ${inherited.license_id}` : "") +
          (inherited.jurisdictions && inherited.jurisdictions.length
            ? ` · ${inherited.jurisdictions.join(", ")}`
            : "")
        ));
        for (const [label, url] of [
          [t("license"), inherited.license_url],
          [t("terms"), inherited.terms_url],
        ]) {
          if (!url) continue;
          condition.appendChild(document.createTextNode(" · "));
          const link = document.createElement("a");
          link.href = url;
          link.target = "_blank";
          link.rel = "noreferrer";
          link.textContent = label;
          condition.appendChild(link);
        }
        noticeEl.appendChild(condition);
      }
      noticeDetails.appendChild(noticeEl);
    }
    item.appendChild(noticeDetails);
  }

  if (feedbackWanted(result)) {
    entry.feedbackBox = renderFeedback(entry);
    item.appendChild(entry.feedbackBox);
  }

  el.qaHistory.prepend(item);
}

// -- saved questions and feedback -------------------------------------------
//
// A live API that keeps records (GET /api/health says "records": true) saves
// each question with its answer unless the visitor ticks "Don't save my
// questions" under the Ask button; the note there says so before the first
// question. Each answer then takes a rating and an optional comment. Nothing
// is saved without the live API. demo/server.py has the record format.

const SAVE_OPTOUT_KEY = "soprano-lab-save-optout";
const THUMB_ICONS = {
  // Feather icons (MIT): thumbs-up, thumbs-down.
  up:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>',
  down:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>',
};

function questionWillBeSaved() {
  return !el.saveNote.hidden && !el.saveOptOut.checked;
}

function feedbackWanted(result) {
  return Boolean(API_BASE) && (state.recordsEnabled || Boolean(result.record_id));
}

function renderFeedback(entry) {
  const { feedback } = entry;
  const box = document.createElement("div");
  box.className = "qa-feedback";

  const row = document.createElement("div");
  row.className = "feedback-row";
  const prompt = document.createElement("span");
  prompt.textContent = t("feedbackPrompt");
  row.appendChild(prompt);
  for (const rating of ["up", "down"]) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "feedback-btn" + (feedback.rating === rating ? " active" : "");
    btn.setAttribute("aria-pressed", String(feedback.rating === rating));
    btn.setAttribute("aria-label", t(rating === "up" ? "feedbackUp" : "feedbackDown"));
    btn.title = btn.getAttribute("aria-label");
    btn.innerHTML = THUMB_ICONS[rating];
    btn.disabled = Boolean(feedback.sending);
    btn.addEventListener("click", () => rateAnswer(entry, rating));
    row.appendChild(btn);
  }
  box.appendChild(row);

  if (feedback.rating && !feedback.commentSent) {
    const form = document.createElement("div");
    form.className = "feedback-form";
    const comment = document.createElement("textarea");
    comment.rows = 2;
    comment.maxLength = 2000;
    comment.placeholder = t("feedbackCommentPlaceholder");
    comment.value = feedback.draft;
    comment.addEventListener("input", () => {
      feedback.draft = comment.value;
    });
    const send = document.createElement("button");
    send.type = "button";
    send.className = "feedback-send";
    send.textContent = t("feedbackSend");
    send.disabled = Boolean(feedback.sending);
    send.addEventListener("click", () => sendComment(entry));
    form.append(comment, send);
    box.appendChild(form);
  }

  if (feedback.status) {
    const status = document.createElement("p");
    status.className = "feedback-status" + (feedback.status === "feedbackFailed" ? " error" : "");
    status.setAttribute("role", "status");
    status.textContent = t(feedback.status);
    box.appendChild(status);
  }
  return box;
}

function refreshFeedback(entry) {
  if (!entry.feedbackBox || !entry.feedbackBox.isConnected) return;
  const fresh = renderFeedback(entry);
  entry.feedbackBox.replaceWith(fresh);
  entry.feedbackBox = fresh;
}

async function postFeedback(entry, fields) {
  const { result } = entry;
  try {
    const res = await fetch(API_BASE + "/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        record_id: result.record_id || null,
        answer_file: result.answer_file || null,
        piece_id: result.piece_id,
        language: result.language || state.lang,
        ...fields,
      }),
    });
    return res.ok;
  } catch (_) {
    return false;
  }
}

async function rateAnswer(entry, rating) {
  const { feedback } = entry;
  if (feedback.sending || feedback.rating === rating) return;
  const previous = feedback.rating;
  Object.assign(feedback, { rating, sending: true, status: "" });
  refreshFeedback(entry);
  const sent = await postFeedback(entry, { rating });
  Object.assign(feedback, { sending: false }, sent ? {} : { rating: previous, status: "feedbackFailed" });
  refreshFeedback(entry);
}

async function sendComment(entry) {
  const { feedback } = entry;
  const comment = feedback.draft.trim();
  if (feedback.sending || !comment) return;
  Object.assign(feedback, { sending: true, status: "" });
  refreshFeedback(entry);
  const sent = await postFeedback(entry, { rating: feedback.rating, comment });
  Object.assign(
    feedback,
    { sending: false, status: sent ? "feedbackThanks" : "feedbackFailed" },
    sent ? { commentSent: true, draft: "" } : {}
  );
  refreshFeedback(entry);
}

try {
  el.saveOptOut.checked = window.localStorage.getItem(SAVE_OPTOUT_KEY) === "1";
} catch (_) {
  /* storage unavailable */
}
el.saveOptOut.addEventListener("change", () => {
  try {
    window.localStorage.setItem(SAVE_OPTOUT_KEY, el.saveOptOut.checked ? "1" : "0");
  } catch (_) {
    /* storage unavailable */
  }
});

async function askQuestion() {
  const question = el.question.value.trim();
  if (!question) {
    el.askStatus.textContent = t("typeQuestionFirst");
    return;
  }
  const scope = document.querySelector('input[name="scope"]:checked').value;
  let measureRange = null;
  if (scope === "range") {
    if (!state.range) {
      el.askStatus.textContent = t("selectRangeFirst");
      return;
    }
    measureRange = state.range;
  }

  el.askBtn.disabled = true;
  let liveError = null;
  try {
    if (API_BASE) {
      try {
        const result = await askLive(question, measureRange);
        el.askStatus.textContent = "";
        addQAItem(question, result);
        el.question.value = "";
        return;
      } catch (err) {
        if (!err.liveUnavailable) {
          throw err;
        }
        liveError = err;
      }
    }
    // Only the sample questions have precomputed answers.
    const saved = await findSavedAnswer(
      state.currentPieceId,
      question,
      measureRange
    );
    if (!saved) {
      el.askStatus.textContent = liveError
        ? liveError.message
        : t("samplesOnly");
      return;
    }
    el.askStatus.textContent = t("loadingSaved");
    const result = await fetchJSON(dataUrl(saved.file));
    result.precomputed = true;
    result.answer_file = saved.file;
    el.askStatus.textContent =
      liveError && liveError.message !== t("liveUnavailable") ? liveError.message : "";
    addQAItem(question, result);
    el.question.value = "";
  } catch (err) {
    el.askStatus.textContent = t("somethingWrong", { message: err.message });
  } finally {
    el.askBtn.disabled = false;
  }
}

// A request that got no usable response (a dropped connection, or a host
// error without CORS headers) is retried once before giving up.
async function postQuestion(body) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fetch(API_BASE + "/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
    } catch (err) {
      if (attempt >= 2) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
}

// POST the question to the live API. Errors that mean "the live model cannot
// answer now" (unreachable, rate or quota limits, server errors) are marked
// liveUnavailable so the caller can fall back to a saved answer; request
// errors (4xx) are shown as they are.
async function askLive(question, measureRange) {
  el.askStatus.textContent = t("thinking");
  const slowNotice = setTimeout(() => {
    el.askStatus.textContent = t("stillThinking");
  }, SLOW_ANSWER_NOTICE_MS);
  let res;
  try {
    res = await postQuestion(
      // Answers come in the page language, whatever the question's.
      JSON.stringify({
        piece_id: state.currentPieceId,
        question,
        measure_range: measureRange,
        generate: true,
        language: state.lang,
        save: questionWillBeSaved(),
      })
    );
  } catch (_) {
    throw Object.assign(new Error(t("liveUnavailable")), {
      liveUnavailable: true,
    });
  } finally {
    clearTimeout(slowNotice);
  }
  if (res.ok) {
    return res.json();
  }
  let message = "";
  try {
    message = (await res.json()).error || "";
  } catch (_) {
    /* ignore */
  }
  const unavailable = res.status === 429 || res.status >= 500;
  // The server's 429 and 503 messages are written for visitors; show them in
  // the page language. Other server errors get the generic notice.
  if (res.status === 429) {
    message = /daily/i.test(message) ? t("dailyLimit") : t("shortLimit");
  } else if (res.status === 503 && message) {
    message = t("liveCouldNotAnswer");
  } else if (unavailable) {
    message = t("liveUnavailable");
  }
  throw Object.assign(new Error(message || res.statusText || t("liveUnavailable")), {
    liveUnavailable: unavailable,
  });
}

let savedAnswerIndex = null;

async function findSavedAnswer(pieceId, question, measureRange) {
  if (!savedAnswerIndex) {
    savedAnswerIndex = fetchJSON(dataUrl("answers/index.json"))
      .then((data) => data.answers)
      .catch((err) => {
        // Let the next question retry instead of failing until a reload.
        savedAnswerIndex = null;
        throw err;
      });
  }
  const answers = await savedAnswerIndex;
  const rangeKey = JSON.stringify(measureRange || null);
  return answers.find(
    (entry) =>
      entry.piece_id === pieceId &&
      entry.question === question &&
      JSON.stringify(entry.measure_range || null) === rangeKey
  );
}

el.askBtn.addEventListener("click", askQuestion);

if (API_BASE) {
  // Wake a scaled-to-zero API host while the visitor reads the score. The
  // save note shows meanwhile; it goes away if the API keeps no records.
  el.saveNote.hidden = false;
  fetch(API_BASE + "/api/health")
    .then((res) => (res.ok ? res.json() : {}))
    .catch(() => ({}))
    .then((health) => {
      state.recordsEnabled = health.records === true;
      el.saveNote.hidden = !state.recordsEnabled;
      if (state.recordsEnabled && state.history.length) renderHistory();
    });
} else {
  el.question.dataset.i18nPlaceholder = "questionPlaceholderSamplesOnly";
}

// Example questions, in the page language: per piece, up to three about the
// whole piece (range null), then up to three about a measure range, which
// select that range. They are the paper's sample questions
// (rag/sample_questions.md), with their wording and scope, and otherwise the
// dataset's evaluation questions (expert_curation/evaluation_questions), in
// their paraphrased wording and scope; no question is written for the page.
// English wording is the parallel English dataset's (two paper questions
// without a counterpart there are translated directly).
const EXAMPLE_QUESTIONS = {
  "die-forelle": [
    { text: "Why is this piece difficult to sing even though its notes are not high?", range: null },
    { text: "What should a singer do when German pronunciation is difficult?", range: null },
    { text: "What should a singer do to sing this piece well?", range: null },
    { text: "What does the accent on the second beat in the piano part express?", range: [2, 27] },
    { text: "How should a change in the piece's mood be expressed?", range: [28, 40] },
  ],
  "una-voce-poco-fa": [
    { text: "The interludes in this piece are so long that I don't know what to do during them.", range: null },
    { text: "How should one practice coloratura technique effectively?", range: null },
    { text: "Why does this aria contain so many ornaments?", range: null },
    { text: "Why did Rossini use a double-dotted rhythm instead of a standard dotted rhythm?", range: [21, 22] },
    { text: "How can rapid diction be practiced in passages with many short notes?", range: [31, 34] },
    { text: "Why do some performances approach ma with portamento after guidar?", range: [67, 67] },
  ],
  "la-capinera": [
    { text: "How should lyrics be fitted when technique or ornamentation is involved?", range: null },
    { text: "How should a slashed ornament be fitted into the rhythm?", range: [22, 22] },
    { text: "How should the lyrics l’erbe ed i fior be placed on the pitches?", range: [80, 80] },
    { text: "What musical effect does the contrast between ff and pp express?", range: [117, 124] },
  ],
  "nella-fantasia": [
    { text: "Can this piece be regarded as classical, and can it be sung with classical vocal production?", range: null },
    { text: "Are there restrictions on the singer's gender or voice type for this piece?", range: null },
    { text: "What does D.S. al Coda indicate?", range: null },
    { text: "With what dynamic should the opening note begin?", range: [7, 8] },
    { text: "How should a sudden upward leap be sung?", range: [11, 17] },
    { text: "What should a singer do when singing is difficult or breath runs short?", range: [44, 52] },
  ],
  "in-flowery-clouds": [
    { text: "If this song is too high, may I adjust or arrange it?", range: null },
    { text: "Why does the piece return to its earlier meter?", range: null },
    { text: "What are the small notes?", range: null },
    { text: "If kkotbaram (\"flower breeze\") is often sung staccato in recordings but has no such marking in the score, what should guide the performance?", range: [11, 12] },
    { text: "What should I do if the first note does not come out well when a phrase begins on a high note?", range: [19, 21] },
    { text: "Why does the meter change, and how does the mood of the piece change?", range: [39, 49] },
  ],
};

// The same questions in their original Korean wording, in the same order.
const EXAMPLE_QUESTIONS_KO = {
  "die-forelle": [
    { text: "음이 높지 않은데도 이 곡을 부르기 어려운 이유는 무엇일까?", range: null },
    { text: "독일어 발음이 어려울 때 어떻게 해야 할까?", range: null },
    { text: "이 곡을 잘 부르려면 어떻게 해야 할까?", range: null },
    { text: "피아노 파트에서 두 번째 박의 악센트는 무엇을 표현할까?", range: [2, 27] },
    { text: "곡의 분위기가 바뀔 때 어떻게 표현하는 것이 좋을까?", range: [28, 40] },
  ],
  "una-voce-poco-fa": [
    { text: "이 곡에 간주가 너무 길어서 그동안 뭘 해야할지 모르겠다", range: null },
    { text: "콜로라투라 테크닉을 잘 익히려면 어떻게 연습할까?", range: null },
    { text: "꾸밈음이 많이 나오는 이유는 무엇일까?", range: null },
    { text: "로시니가 일반적인 부점 리듬 대신 겹부점 리듬을 사용한 이유는 무엇일까?", range: [21, 22] },
    { text: "짧은 음표가 많은 부분에서 빠른 발음은 어떻게 연습할까?", range: [31, 34] },
    { text: "유튜브 영상에서 guidar 뒤에 portamento로 ma를 내는 이유는 무엇일까?", range: [67, 67] },
  ],
  "la-capinera": [
    { text: "테크닉이나 기교가 들어갈 때 가사는 어떻게 붙여야 할까?", range: null },
    { text: "사선이 그어진 꾸밈음은 리듬에 맞춰 어떻게 불러야 할까?", range: [22, 22] },
    { text: "‘l’erbe ed i fior’의 가사를 음정에 어떻게 붙여야 할까?", range: [80, 80] },
    { text: "ff와 pp의 대비는 어떤 음악적 효과를 표현할까?", range: [117, 124] },
  ],
  "nella-fantasia": [
    { text: "이 곡을 클래식 장르로 볼 수 있을까? 클래식 발성으로 불러도 될까?", range: null },
    { text: "이 곡을 부르는 데 성별이나 성부의 제한이 있을까?", range: null },
    { text: "D.S. al Coda는 어떤 뜻일까?", range: null },
    { text: "첫 소리는 어떤 다이나믹으로 시작할까?", range: [7, 8] },
    { text: "음이 갑자기 올라갈 때 어떻게 부르는 것이 좋을까?", range: [11, 17] },
    { text: "노래하기 힘들거나 숨이 부족할 때 어떻게 해야 할까?", range: [44, 52] },
  ],
  "in-flowery-clouds": [
    { text: "이 노래가 너무 높으면 조정하거나 편곡해도 될까?", range: null },
    { text: "박자가 다시 이전 박자로 돌아오는 이유는 무엇일까?", range: null },
    { text: "작은 음표들은 무엇일까?", range: null },
    { text: "‘꽃바람’을 음원에서는 스타카토로 부르는 경우가 많지만 악보에 표시가 없다면 무엇을 따라야 할까?", range: [11, 12] },
    { text: "프레이즈의 시작에 높은 음이 나오는 경우 첫 소리가 잘 나지 않으면 어떻게 해야 할까?", range: [19, 21] },
    { text: "박자가 바뀌는 이유는 무엇이며, 곡의 분위기는 어떻게 달라질까?", range: [39, 49] },
  ],
};

function exampleQuestionsFor(lang) {
  const lists = lang === "ko" ? EXAMPLE_QUESTIONS_KO : EXAMPLE_QUESTIONS;
  return lists[state.currentPieceId] || [];
}

function applyExampleQuestion(example) {
  el.question.value = example.text;
  if (example.range && state.currentPiece && state.currentPiece.measures_known) {
    state.range = example.range.slice();
    state.rangeAnchor = null;
    updateRangeInputsFromState();
    updateRangeHighlight();
    const firstBox = state.measureBoxes.get(example.range[0]);
    if (firstBox) firstBox.scrollIntoView({ behavior: "smooth", block: "center" });
  } else if (!example.range) {
    // A whole-piece question replaces the range an earlier example selected.
    state.range = null;
    state.rangeAnchor = null;
    updateRangeInputsFromState();
    updateRangeHighlight();
  }
  const scope = example.range && state.range ? "range" : "whole";
  const radio = document.querySelector(`input[name="scope"][value="${scope}"]`);
  if (radio) radio.checked = true;
  el.question.focus();
}

// Whole-piece and measure-range examples are shown as two groups; a group
// without examples for the piece is hidden.
function renderExampleQuestions() {
  const examples = exampleQuestionsFor(state.lang);
  for (const [box, wantsRange] of [
    [el.exampleQuestionsWhole, false],
    [el.exampleQuestionsRange, true],
  ]) {
    if (!box) continue;
    box.innerHTML = "";
    for (const example of examples.filter((e) => Boolean(e.range) === wantsRange)) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "example-chip";
      const text = document.createElement("span");
      text.textContent = example.text;
      btn.appendChild(text);
      if (example.range) {
        const range = document.createElement("span");
        range.className = "chip-range";
        range.textContent = t("tagMeasures", { from: example.range[0], to: example.range[1] });
        btn.appendChild(range);
      }
      btn.addEventListener("click", () => applyExampleQuestion(example));
      box.appendChild(btn);
    }
    box.closest(".example-group").hidden = !box.childElementCount;
  }
}
renderExampleQuestions();
el.question.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) askQuestion();
});

// -- boot ---------------------------------------------------------------

applyStaticStrings();

loadPieces().catch((err) => {
  console.error("Failed to load pieces:", err);
});
