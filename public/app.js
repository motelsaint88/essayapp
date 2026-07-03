const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

let currentQuestion = null;
let meUsername = null;
let meIsAdmin = false;

async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ---------- Boot ----------
(async function init() {
  try {
    const me = await api('/api/me');
    if (me.username) showApp(me);
    else showLogin();
  } catch {
    showLogin();
  }
})();

function showLogin() {
  $('#login-screen').style.display = 'flex';
  $('#app-screen').style.display = 'none';
}

async function showApp(me) {
  $('#login-screen').style.display = 'none';
  $('#app-screen').style.display = 'block';
  $('#who-name').textContent = me.name;
  meUsername = me.username;
  meIsAdmin = !!me.isAdmin;

  $('#admin-badge').style.display = meIsAdmin ? 'inline-block' : 'none';
  $('#set-question-btn').style.display = meIsAdmin ? 'inline' : 'none';
  // delete-question-btn visibility is also controlled in loadQuestion() based on whether a question exists

  await loadQuestion();
  await loadArchive();
  await loadOverall();
}

// ---------- Login ----------
$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  $('#login-error').textContent = '';
  try {
    const me = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({
        username: $('#login-username').value.trim(),
        password: $('#login-password').value
      })
    });
    showApp(me);
  } catch (err) {
    $('#login-error').textContent = err.message;
  }
});

$('#logout-btn').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  location.reload();
});

// ---------- Tabs ----------
$$('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    $$('.tab').forEach(t => t.classList.remove('active'));
    $$('.tab-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    $('#tab-' + tab.dataset.tab).classList.add('active');
    if (tab.dataset.tab === 'board') loadArchive();
    if (tab.dataset.tab === 'overall') loadOverall();
  });
});

// ---------- Question ----------
async function loadQuestion() {
  const { question } = await api('/api/question');
  currentQuestion = question;
  $('#current-question').textContent = question
    ? question.text
    : (meIsAdmin
        ? 'No question has been set yet — click "Set / change question" to add today\'s essay topic.'
        : 'No question has been set yet. Waiting for the admin to post one.');
  $('#delete-question-btn').style.display = (question && meIsAdmin) ? 'inline' : 'none';
}

$('#set-question-btn').addEventListener('click', () => {
  if (!meIsAdmin) return;
  $('#question-form').style.display = 'block';
  $('#question-input').value = currentQuestion ? currentQuestion.text : '';
  $('#question-input').focus();
});

$('#cancel-question-btn').addEventListener('click', () => {
  $('#question-form').style.display = 'none';
});

$('#save-question-btn').addEventListener('click', async () => {
  const text = $('#question-input').value.trim();
  if (!text) return;
  try {
    await api('/api/question', { method: 'POST', body: JSON.stringify({ text }) });
    $('#question-form').style.display = 'none';
    $('#own-feedback').innerHTML = '';
    $('#essay-input').value = '';
    updateWritingAssistant();
    await loadQuestion();
    await loadArchive();
  } catch (err) {
    alert(err.message);
  }
});

$('#delete-question-btn').addEventListener('click', async () => {
  if (!currentQuestion) return;
  if (!confirm('Delete this question and EVERYONE\'s essays/grades for it? This cannot be undone.')) return;
  try {
    await api(`/api/question/${currentQuestion.id}`, { method: 'DELETE' });
    $('#essay-input').value = '';
    updateWritingAssistant();
    $('#own-feedback').innerHTML = '';
    await loadQuestion();
    await loadArchive();
    await loadOverall();
  } catch (err) {
    alert(err.message);
  }
});

// ---------- Essay submit ----------
const TARGET_MIN_WORDS = 220;
const TARGET_MAX_WORDS = 280;

function updateWritingAssistant() {
  const text = $('#essay-input').value.trim();
  const words = text ? text.split(/\s+/).filter(Boolean) : [];
  const wordCount = words.length;
  const paragraphCount = text ? text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean).length : 0;
  const readingMin = Math.max(0, Math.round((wordCount / 200) * 10) / 10);

  $('#live-word-count').textContent = wordCount;
  $('#live-reading-time').textContent = readingMin;
  $('#live-paragraphs').textContent = paragraphCount;

  let pct;
  if (wordCount === 0) pct = 0;
  else if (wordCount < TARGET_MIN_WORDS) pct = Math.round((wordCount / TARGET_MIN_WORDS) * 100);
  else if (wordCount > TARGET_MAX_WORDS) pct = 100;
  else pct = 100;

  $('#progress-ring').style.setProperty('--pct', pct);
  $('#progress-pct').textContent = pct + '%';
}

$('#essay-input').addEventListener('input', updateWritingAssistant);

$('#submit-essay-btn').addEventListener('click', async () => {
  const text = $('#essay-input').value.trim();
  const statusEl = $('#submit-status');
  if (!text) { statusEl.textContent = 'Write your essay first.'; statusEl.className = 'status-text err'; return; }
  if (!currentQuestion) { statusEl.textContent = 'No question set yet.'; statusEl.className = 'status-text err'; return; }

  statusEl.textContent = 'Grading... this can take a few seconds.';
  statusEl.className = 'status-text';
  $('#submit-essay-btn').disabled = true;

  try {
    const result = await api('/api/essay', {
      method: 'POST',
      body: JSON.stringify({ questionId: currentQuestion.id, text })
    });
    statusEl.textContent = 'Graded.';
    statusEl.className = 'status-text ok';
    $('#own-feedback').innerHTML = `<div class="script-card" style="margin-top:20px;">${renderScriptCard({
      name: 'Your result', status: 'graded', score: result.score,
      feedback: result, essay: text
    }, false)}</div>`;
    loadArchive();
    loadOverall();
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message;
    statusEl.className = 'status-text err';
  } finally {
    $('#submit-essay-btn').disabled = false;
  }
});

// ---------- Marked Scripts (saved essays, today + yesterday) ----------
async function loadArchive() {
  const { archive } = await api('/api/archive');
  const container = $('#archive-container');
  container.innerHTML = '';

  if (!archive.length) {
    container.innerHTML = '<p class="no-archive">Nothing saved yet — once a question is set and answers come in, they\'ll show up here.</p>';
    return;
  }

  archive.forEach((day, i) => {
    const section = document.createElement('section');
    section.className = 'archive-day';

    const label = i === 0 ? 'Today' : i === 1 ? 'Yesterday' : new Date(day.question.created_at).toLocaleDateString();

    const head = document.createElement('div');
    head.className = 'archive-day-head';
    head.innerHTML = `<span class="day-stamp">${label}</span><p class="question-text small">${escapeHtml(day.question.text)}</p>`;
    section.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'board-grid';

    day.entries.forEach(entry => {
      const card = document.createElement('div');
      if (entry.status === 'not_submitted') {
        card.className = 'script-card';
        card.innerHTML = `<p class="fb-name">${entry.name}</p><p class="not-submitted">Hasn't submitted yet.</p>`;
      } else if (entry.status === 'pending') {
        card.className = 'script-card';
        card.innerHTML = `<p class="fb-name">${entry.name}</p><p class="not-submitted">Grading in progress...</p>`;
      } else if (entry.status === 'error') {
        card.className = 'script-card';
        card.innerHTML = `<p class="fb-name">${entry.name}</p><p class="not-submitted">Grading failed — they need to resubmit.</p>` +
          (entry.essay ? `<details class="essay-reveal"><summary>Read the essay</summary><p class="essay-text">${escapeHtml(entry.essay)}</p></details>` : '');
      } else {
        card.innerHTML = renderScriptCard(entry, meIsAdmin);
        if (meIsAdmin) {
          card.querySelector('.admin-delete-btn').addEventListener('click', async () => {
            if (!confirm(`Delete ${entry.name}'s essay and grade for this question?`)) return;
            await api(`/api/essay/${day.question.id}/${entry.username}`, { method: 'DELETE' });
            loadArchive();
            loadOverall();
          });
        }
      }
      grid.appendChild(card);
    });

    section.appendChild(grid);
    container.appendChild(section);
  });
}

const RUBRIC_LABELS = {
  relevance: 'Relevance',
  structure: 'Structure',
  language: 'Language',
  depth_originality: 'Depth & Originality'
};

const CHECKLIST_LABELS = {
  title: 'Title',
  hook: 'Hook',
  background: 'Background',
  thesis: 'Thesis',
  body_paragraphs: 'Body paragraphs',
  conclusion_restated_thesis: 'Restated thesis',
  final_insight: 'Final insight',
  strong_ending: 'Strong ending'
};

function bandClass(band) {
  return 'b-' + String(band || '').toLowerCase().replace(/\s+/g, '-');
}

function renderScriptCard(entry, showAdminDelete) {
  const fb = entry.feedback || {};
  const band = fb.band || '—';
  const rubric = fb.rubric || {};
  const checklist = fb.checklist || {};
  const stats = fb.statistics || {};
  const mistakes = fb.mistakes || [];
  const words = fb.uncommon_words || [];

  const essayHtml = entry.essay ? `
    <details class="essay-reveal">
      <summary>Read the essay</summary>
      <p class="essay-text">${escapeHtml(entry.essay)}</p>
    </details>` : '';

  const rubricHtml = Object.keys(RUBRIC_LABELS).map(key => {
    const r = rubric[key] || { score: 0 };
    const pct = Math.round((r.score / 10) * 100);
    return `
      <div class="rubric-row">
        <div class="rubric-row-top">
          <span class="rubric-label">${RUBRIC_LABELS[key]}</span>
          <span class="rubric-score">${r.score} / 10</span>
        </div>
        <div class="rubric-bar"><div class="rubric-bar-fill" style="width:${pct}%"></div></div>
      </div>`;
  }).join('');

  const checklistHtml = Object.keys(CHECKLIST_LABELS).map(key => `
    <span class="check-item ${checklist[key] ? 'yes' : ''}">${checklist[key] ? '✓' : '·'} ${CHECKLIST_LABELS[key]}</span>
  `).join('');

  const readingMin = Math.max(1, Math.round((stats.reading_time_seconds || 0) / 60));
  const statsHtml = `
    <div class="stat-list-row"><span>Word Count</span><span>${stats.word_count ?? '—'}</span></div>
    <div class="stat-list-row"><span>Paragraphs</span><span>${stats.paragraph_count ?? '—'}</span></div>
    <div class="stat-list-row"><span>Sentences</span><span>${stats.sentence_count ?? '—'}</span></div>
    <div class="stat-list-row"><span>Avg. Sentence Length</span><span>${stats.avg_sentence_length ?? '—'}</span></div>
    <div class="stat-list-row"><span>Reading Time</span><span>${readingMin} min</span></div>
  `;

  const mistakesHtml = mistakes.length
    ? mistakes.slice(0, 4).map(m => `
        <div class="mistake-item">
          <span class="sev-badge sev-${(m.severity || 'minor').toLowerCase()}">${escapeHtml(m.severity || 'Minor')}</span>
          ${m.original ? `<p class="mistake-original">"${escapeHtml(m.original)}"</p>` : ''}
          ${m.improved ? `<p class="mistake-arrow">→ ${escapeHtml(m.improved)}</p>` : ''}
        </div>`).join('')
    : '<p class="no-mistakes">No grammar issues found.</p>';

  const wordsHtml = words.length
    ? words.map(w => `<span class="word-chip"><b>${escapeHtml(w.word)}</b> — ${escapeHtml(w.meaning)}</span>`).join('')
    : '<p class="no-mistakes">None flagged for this essay.</p>';

  const formatNoteHtml = (fb.format_notes || []).length ? `
    <div class="r-card format-note-card">
      <h4>Format note</h4>
      <ul class="plain-list">${fb.format_notes.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>
    </div>` : '';

  return `
    <div class="result-head">
      <p class="fb-name">${entry.name || ''}</p>
      <span class="fb-status">Graded${fb.essay_type_detected ? ` · ${escapeHtml(fb.essay_type_detected)}` : ''}</span>
    </div>
    ${essayHtml}

    <div class="result-wrap">
      <div class="result-grid-top">
        <div class="r-card score">
          <h4>Overall Score</h4>
          <div class="score-value">${entry.score}<small> / 40</small></div>
          <span class="band-chip ${bandClass(band)}">${escapeHtml(band)}</span>
        </div>
        <div class="r-card rubric">
          <h4>Rubric Breakdown</h4>
          ${rubricHtml}
        </div>
        <div class="r-card stats">
          <h4>Statistics</h4>
          <div class="stat-list">${statsHtml}</div>
        </div>
        <div class="r-card type">
          <h4>Essay Type Detected</h4>
          <div class="type-value">${escapeHtml(fb.essay_type_detected || 'Unclassified')}</div>
          <div class="type-confidence">Confidence: ${escapeHtml(fb.confidence || 'medium')}</div>
        </div>
      </div>

      <div class="result-grid-mid">
        <div class="r-card">
          <h4>Handbook Checklist</h4>
          <div class="check-grid">${checklistHtml}</div>
        </div>
        <div class="r-card">
          <h4>Examiner's Comment</h4>
          <p class="examiner-text">${escapeHtml(fb.examiner_comment || 'No comment generated.')}</p>
        </div>
      </div>

      <div class="result-grid-bottom">
        <div class="r-card strengths">
          <h4>Strengths</h4>
          <ul class="plain-list">${(fb.strengths || []).map(s => `<li>${escapeHtml(s)}</li>`).join('') || '<li>—</li>'}</ul>
        </div>
        <div class="r-card improve">
          <h4>Areas to Improve</h4>
          <ul class="plain-list">${(fb.improvements || []).map(s => `<li>${escapeHtml(s)}</li>`).join('') || '<li>—</li>'}</ul>
        </div>
        <div class="r-card grammar">
          <h4>Top Grammar Issues</h4>
          ${mistakesHtml}
        </div>
        <div class="r-card words">
          <h4>Advanced Words Used</h4>
          ${wordsHtml}
        </div>
      </div>
      ${formatNoteHtml}
    </div>

    ${showAdminDelete ? `<button class="admin-delete-btn">Delete this essay</button>` : ''}
  `;
}

// ---------- Overall ----------
async function loadOverall() {
  const { overall } = await api('/api/overall');
  const body = $('#overall-body');
  body.innerHTML = overall.map((row, i) => `
    <tr>
      <td class="rank">${i + 1}</td>
      <td>${row.name}</td>
      <td>${row.essays}</td>
      <td>${row.total}</td>
      <td>${row.avg}</td>
    </tr>
  `).join('');
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
