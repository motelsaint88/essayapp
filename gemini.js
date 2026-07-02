// gemini.js — handles the call to Gemini to grade one essay against one question.
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

function buildPrompt(question, essay) {
  return `You are a strict but fair admissions-essay evaluator for BRAC University and NSU (North South University) undergraduate admission essays in Bangladesh.

IMPORTANT FORMAT CONTEXT — READ CAREFULLY BEFORE GRADING:
This is NOT a traditional long-form academic essay. It is a short admission essay, roughly one page, with an ideal length of about 220-280 words across 4-5 short paragraphs (intro, 2-3 body paragraphs, conclusion). Going somewhat over 280 words is fine and should not be penalized on its own. Do NOT judge "depth of thought" or "development of ideas" by the standards of a 1000+ word academic essay — within this short format, a well-chosen single example, explained concretely and reflectively, is exactly what is expected and should score well. Do not deduct marks just because the essay is short, has few paragraphs, or doesn't explore multiple angles — that is normal and correct for this format. Only deduct for depth if the essay is vague, generic, or lacks any concrete specific detail regardless of length. If the essay is far outside a reasonable range (under ~150 words or over ~450 words), you may mention this once as a point in "improvements" — but do not otherwise reduce the score for length within the normal 220-350 word range.

QUESTION GIVEN TO THE STUDENT:
"""${question}"""

STUDENT'S ESSAY:
"""${essay}"""

Grade this essay out of 40 total marks, using this rubric internally (do not print the rubric, just use it), calibrated to the short admission-essay format described above:
- Relevance & how well it answers the question (10)
- Structure & organization / flow of ideas within a short 4-5 paragraph format (10)
- Language, grammar, and sentence variety (10)
- Depth of thought, originality, and specific examples — judged by how well the student uses the limited space, not by total length (10)

Also identify any genuinely uncommon or advanced English words/phrases the student used well (words a typical Bangladeshi HSC-level student would NOT normally use) — not basic words. If there are none, return an empty list. For each, give a one-line meaning in simple English.

Respond with ONLY valid JSON, no markdown fences, no extra text, in exactly this shape:
{
  "score": <integer 0-40>,
  "strengths": ["short point", "short point", ...],
  "mistakes": ["short point", "short point", ...],
  "improvements": ["short actionable point", "short actionable point", ...],
  "uncommon_words": [{"word": "example", "meaning": "short meaning"}, ...]
}

Keep each list to 3-6 concise bullet points. Be specific to THIS essay, never generic filler.`;
}

function extractJson(text) {
  let t = text.trim();
  t = t.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object found in model response');
  return JSON.parse(t.slice(start, end + 1));
}

async function gradeEssay(question, essay) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set in .env');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;

  const body = {
    contents: [{ parts: [{ text: buildPrompt(question, essay) }] }],
    generationConfig: { temperature: 0.4, responseMimeType: 'application/json' }
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

  const parsed = extractJson(text);

  // basic shape safety
  return {
    score: Math.max(0, Math.min(40, Math.round(Number(parsed.score) || 0))),
    strengths: Array.isArray(parsed.strengths) ? parsed.strengths.slice(0, 8) : [],
    mistakes: Array.isArray(parsed.mistakes) ? parsed.mistakes.slice(0, 8) : [],
    improvements: Array.isArray(parsed.improvements) ? parsed.improvements.slice(0, 8) : [],
    uncommon_words: Array.isArray(parsed.uncommon_words) ? parsed.uncommon_words.slice(0, 12) : []
  };
}

module.exports = { gradeEssay };
