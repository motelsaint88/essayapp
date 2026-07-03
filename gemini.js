// gemini.js — builds the grading prompt, calls Gemini, and turns the raw
// model output into a validated, scored result.
//
// Design:
//   1. computeStatistics()   — objective numbers Node calculates itself
//      (word count, paragraphs, etc). These are handed TO Gemini so it
//      never has to guess them, and are also returned to the frontend.
//   2. buildPrompt()         — assembled from small section-builders so the
//      instructions (role / reasoning steps / handbook / rubric / anchors /
//      schema) can be edited independently instead of living in one blob.
//   3. callGemini()          — the actual HTTP call, JSON-mode, with one
//      automatic retry if the model returns malformed JSON.
//   4. validateAndScore()    — never trusts the model's arithmetic; clamps
//      every field, fills missing arrays, and calculates score/band itself.

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// ---------------------------------------------------------------------------
// 1. Objective statistics (computed in Node, not by the model)
// ---------------------------------------------------------------------------

function computeStatistics(essay) {
  const trimmed = essay.trim();
  const lines = trimmed.split('\n').map(l => l.trim()).filter(Boolean);

  const words = trimmed.split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  const sentences = trimmed
    .split(/[.!?]+(?:\s|$)/)
    .map(s => s.trim())
    .filter(Boolean);
  const sentenceCount = Math.max(sentences.length, 1);

  const paragraphs = trimmed
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(Boolean);
  const paragraphCount = Math.max(paragraphs.length, 1);

  const avgSentenceLength = Math.round((wordCount / sentenceCount) * 10) / 10;
  const readingTimeSeconds = Math.max(1, Math.round((wordCount / 200) * 60));

  // Heuristic title detection: a short first line (<=12 words), no terminal
  // sentence punctuation, sitting on its own line above the rest.
  let titleDetected = false;
  let titleText = null;
  if (lines.length > 1) {
    const first = lines[0];
    const firstWordCount = first.split(/\s+/).filter(Boolean).length;
    const endsLikeSentence = /[.!?]$/.test(first);
    if (firstWordCount >= 1 && firstWordCount <= 12 && !endsLikeSentence) {
      titleDetected = true;
      titleText = first;
    }
  }

  return {
    word_count: wordCount,
    sentence_count: sentenceCount,
    paragraph_count: paragraphCount,
    avg_sentence_length: avgSentenceLength,
    reading_time_seconds: readingTimeSeconds,
    title_detected: titleDetected,
    title_text: titleText
  };
}

// ---------------------------------------------------------------------------
// 2. Prompt — assembled from independent sections
// ---------------------------------------------------------------------------

function sectionRole() {
  return `You are a strict but fair admissions-essay examiner for BRAC University (BRACU) and NSU (North South University) undergraduate admission essays in Bangladesh. You are grading a short admission essay — NOT an IELTS/TOEFL essay, NOT an academic research paper. This is roughly one page, ideal length about 220-280 words across 4-5 short paragraphs (intro, 2-3 body paragraphs, conclusion). Going somewhat over 280 words is fine and should not be penalized on its own. Do not judge depth of thought by the standards of a 1000+ word academic essay — a single well-chosen, concretely explained example is exactly what this short format expects. Only mention length as an issue (once, in format_notes) if the essay is far outside a reasonable range (under ~150 or over ~450 words).`;
}

function sectionInputs(question, essay, stats) {
  return `QUESTION GIVEN TO THE STUDENT:
"""${question}"""

STUDENT'S ESSAY:
"""${essay}"""

OBJECTIVE STATISTICS (already calculated — use these, do not recount):
- Word count: ${stats.word_count}
- Sentence count: ${stats.sentence_count}
- Paragraph count: ${stats.paragraph_count}
- Average sentence length: ${stats.avg_sentence_length} words
- Title detected: ${stats.title_detected ? `yes ("${stats.title_text}")` : 'no'}`;
}

function sectionReasoningSteps() {
  return `Think through the essay in this exact staged order before you write anything to the output. Each stage is evaluated independently — do not let your judgment of one stage bleed into another (e.g. do not lower the relevance score because of a grammar mistake).

Step 1 — Read the whole essay once without judging. Understand what the student is trying to say.
Step 2 — Detect the essay type: Descriptive, Narrative, Persuasive, Argumentative, Cause & Effect, Compare & Contrast, or Process. If two types fit, pick the closest one. Never penalize ambiguity of type.
Step 3 — Understand intention: did the student engage with what the question actually asked?
Step 4 — Evaluate RELEVANCE only. Ignore grammar, vocabulary, spelling. Ask only: did this essay answer the question? Score independently.
Step 5 — Evaluate STRUCTURE only. Ignore language quality and originality. Check: title, introduction (hook/background/thesis), body organization, conclusion, logical flow, paragraph balance, transitions. Score independently.
Step 6 — Evaluate LANGUAGE only. Ignore content/ideas. Check grammar, sentence variety, word choice, academic tone, connector usage, natural fluency. Do not reward unnatural or memorized vocabulary. Score independently.
Step 7 — Evaluate DEPTH & ORIGINALITY only. Check critical thinking, specific concrete examples, personal reflection, authentic reasoning. Do not reward generic filler or writing that reads as AI-generated. Score independently.
Step 8 — Before finalizing any deduction, ask: is this a genuine weakness a real BRACU/NSU examiner would deduct for? Never deduct twice for the same underlying issue across categories.
Step 9 — Build feedback: every strength must point to something specific the essay actually does; every grammar issue must quote the student's exact original words — never invent a quotation that isn't in the essay above.
Step 10 — Only after all four categories are scored independently, report them. Do not pre-decide a total score and reverse-engineer the four numbers.`;
}

function sectionHandbook() {
  return `HANDBOOK — the expected shape of a strong short admission essay (apply flexibly, never as a rigid checklist; reward excellent writing even when the mechanics below aren't followed exactly):
Creative Title -> Introduction (Hook -> Background -> Thesis) -> Body Paragraph 1 -> Body Paragraph 2 -> Body Paragraph 3 (optional third) -> Conclusion (Restated Thesis -> Final Insight -> Strong Ending).`;
}

function sectionRubricAndAnchors() {
  return `RUBRIC — score each 0-10, independently, as described in the reasoning steps:
- relevance: how directly and fully the essay answers the question
- structure: organization and flow within the short format (title, intro, body, conclusion)
- language: grammar, sentence variety, natural academic tone (never reward difficult/dictionary vocabulary over natural clear writing)
- depth_originality: concrete specific examples, authentic personal reasoning, critical thinking

The four rubric scores will be summed by the grading system into a score out of 40 — do not compute this yourself, just give each of the four scores honestly. For calibration, here is what the resulting 0-40 total roughly corresponds to (for your own sense of scale only):
39-40 Outstanding (publication-quality, almost no weaknesses) · 36-38 Excellent (strong structure and reasoning, minor issues only) · 33-35 Strong (clearly above average, some improvement needed) · 29-32 Good (solid, noticeable weaknesses) · 25-28 Average (adequate, several issues) · 20-24 Weak (below admission standard) · below 20 Poor (significant structural and language problems).`;
}

function sectionGrammarAndVocab() {
  return `GRAMMAR: never say "there are grammar mistakes" as a vague statement. For every genuine grammar issue, give an object with the exact original text quoted from the essay, what the issue is, an improved version, and a severity of "Minor", "Moderate", or "Major". If there are truly no grammar mistakes, return an empty array — never invent one to fill the list.

VOCABULARY: identify only genuinely uncommon or advanced words/phrases the student used WELL and naturally (words a typical Bangladeshi HSC-level student would not normally use) — distinguish natural advanced usage from forced/thesaurus-sounding usage, and only reward the former. If none, return an empty array. Also, if you notice a word repeated in a way that weakens the writing, mention it once in improvements with a suggested replacement — do not create a separate repeated-word list.`;
}

function sectionExaminerComment() {
  return `EXAMINER COMMENT: exactly one paragraph, written as a real BRACU/NSU admission examiner would write it by hand — natural, professional, balanced, specific to this essay. It must not sound like a generic AI-generated comment.`;
}

function sectionOutputSchema() {
  return `Respond with ONLY valid JSON, no markdown fences, no commentary outside the JSON, in exactly this shape:
{
  "essay_type_detected": "Narrative | Descriptive | Persuasive | Argumentative | Cause & Effect | Compare & Contrast | Process",
  "confidence": "high | medium | low",
  "rubric": {
    "relevance": { "score": <integer 0-10>, "notes": "one short sentence" },
    "structure": { "score": <integer 0-10>, "notes": "one short sentence" },
    "language": { "score": <integer 0-10>, "notes": "one short sentence" },
    "depth_originality": { "score": <integer 0-10>, "notes": "one short sentence" }
  },
  "checklist": {
    "title": <boolean>,
    "hook": <boolean>,
    "background": <boolean>,
    "thesis": <boolean>,
    "body_paragraphs": <boolean>,
    "conclusion_restated_thesis": <boolean>,
    "final_insight": <boolean>,
    "strong_ending": <boolean>
  },
  "examiner_comment": "exactly one paragraph",
  "format_notes": ["short point about format/length, only if genuinely worth mentioning"],
  "strengths": ["short specific point", "..."],
  "mistakes": [
    { "original": "exact quoted text from the essay", "issue": "what's wrong", "improved": "corrected version", "severity": "Minor | Moderate | Major" }
  ],
  "improvements": ["short actionable point", "..."],
  "uncommon_words": [{ "word": "example", "meaning": "short simple meaning" }]
}

Keep strengths, improvements to 3-6 concise bullet points each. Keep mistakes and uncommon_words to whatever the essay genuinely contains (can be empty arrays). Be specific to THIS essay — never generic filler.`;
}

function buildPrompt(question, essay, stats) {
  return [
    sectionRole(),
    sectionInputs(question, essay, stats),
    sectionReasoningSteps(),
    sectionHandbook(),
    sectionRubricAndAnchors(),
    sectionGrammarAndVocab(),
    sectionExaminerComment(),
    sectionOutputSchema()
  ].join('\n\n');
}

// ---------------------------------------------------------------------------
// 3. Calling Gemini, with one retry on malformed JSON
// ---------------------------------------------------------------------------

function extractJson(text) {
  let t = text.trim();
  t = t.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object found in model response');
  return JSON.parse(t.slice(start, end + 1));
}

async function callGeminiRaw(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set in .env');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3, responseMimeType: 'application/json' }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini API error ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  if (!text) throw new Error('Empty response from Gemini');
  return text;
}

function isMalformedJsonError(err) {
  return err instanceof SyntaxError || /No JSON object found/i.test(err.message || '');
}

async function callGemini(prompt) {
  // config/network/API errors (missing key, bad status, empty response)
  // are allowed to throw straight through — retrying won't help those.
  const text = await callGeminiRaw(prompt);

  try {
    return extractJson(text);
  } catch (firstParseErr) {
    if (!isMalformedJsonError(firstParseErr)) throw firstParseErr;
    // one retry, with a stricter reminder appended — handles the occasional
    // truncated / fenced / chatty malformed response
    const retryPrompt = `${prompt}\n\nREMINDER: your previous response was not valid JSON. Respond with ONLY the raw JSON object described above — no markdown fences, no explanation before or after it.`;
    const retryText = await callGeminiRaw(retryPrompt);
    try {
      return extractJson(retryText);
    } catch (secondParseErr) {
      throw new Error(`Gemini returned malformed JSON twice: ${secondParseErr.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Validation, clamping, and Node-side scoring
// ---------------------------------------------------------------------------

const RUBRIC_KEYS = ['relevance', 'structure', 'language', 'depth_originality'];
const SEVERITIES = ['Minor', 'Moderate', 'Major'];

function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function bandForScore(score) {
  if (score >= 39) return 'Outstanding';
  if (score >= 36) return 'Excellent';
  if (score >= 33) return 'Strong';
  if (score >= 29) return 'Good';
  if (score >= 25) return 'Average';
  if (score >= 20) return 'Weak';
  return 'Poor';
}

function validateAndScore(raw, stats) {
  const rubric = {};
  let total = 0;
  for (const key of RUBRIC_KEYS) {
    const entry = raw?.rubric?.[key] || {};
    const score = clampInt(entry.score, 0, 10, 0);
    rubric[key] = { score, notes: typeof entry.notes === 'string' ? entry.notes.slice(0, 300) : '' };
    total += score;
  }
  total = Math.max(0, Math.min(40, total));

  const checklistDefaults = {
    title: false, hook: false, background: false, thesis: false,
    body_paragraphs: false, conclusion_restated_thesis: false,
    final_insight: false, strong_ending: false
  };
  const checklist = { ...checklistDefaults };
  for (const key of Object.keys(checklistDefaults)) {
    checklist[key] = !!raw?.checklist?.[key];
  }

  const mistakes = Array.isArray(raw?.mistakes)
    ? raw.mistakes.slice(0, 10).map(m => ({
        original: typeof m?.original === 'string' ? m.original.slice(0, 400) : '',
        issue: typeof m?.issue === 'string' ? m.issue.slice(0, 300) : '',
        improved: typeof m?.improved === 'string' ? m.improved.slice(0, 400) : '',
        severity: SEVERITIES.includes(m?.severity) ? m.severity : 'Minor'
      })).filter(m => m.original || m.issue)
    : [];

  const validTypes = ['Descriptive', 'Narrative', 'Persuasive', 'Argumentative', 'Cause & Effect', 'Compare & Contrast', 'Process'];
  const essayType = validTypes.includes(raw?.essay_type_detected) ? raw.essay_type_detected : 'Unclassified';
  const confidence = ['high', 'medium', 'low'].includes(raw?.confidence) ? raw.confidence : 'medium';

  return {
    score: total,
    band: bandForScore(total),
    percentage: Math.round((total / 40) * 1000) / 10,
    essay_type_detected: essayType,
    confidence,
    rubric,
    statistics: stats,
    checklist,
    examiner_comment: typeof raw?.examiner_comment === 'string' ? raw.examiner_comment.slice(0, 1200) : '',
    format_notes: Array.isArray(raw?.format_notes) ? raw.format_notes.slice(0, 3).filter(x => typeof x === 'string') : [],
    strengths: Array.isArray(raw?.strengths) ? raw.strengths.slice(0, 8).filter(x => typeof x === 'string') : [],
    mistakes,
    improvements: Array.isArray(raw?.improvements) ? raw.improvements.slice(0, 8).filter(x => typeof x === 'string') : [],
    uncommon_words: Array.isArray(raw?.uncommon_words)
      ? raw.uncommon_words.slice(0, 12)
          .filter(w => w && typeof w.word === 'string' && typeof w.meaning === 'string')
          .map(w => ({ word: w.word.slice(0, 60), meaning: w.meaning.slice(0, 200) }))
      : []
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

async function gradeEssay(question, essay) {
  const stats = computeStatistics(essay);
  const prompt = buildPrompt(question, essay, stats);
  const raw = await callGemini(prompt);
  return validateAndScore(raw, stats);
}

module.exports = { gradeEssay, computeStatistics, bandForScore };
