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
  $('#update-question-btn').style.display = currentQuestion ? 'inline-block' : 'none';
  $('#save-question-btn').textContent = currentQuestion
    ? 'Start a new question (archives this one)'
    : 'Save question for everyone';
  $('#question-input').focus();
});

$('#cancel-question-btn').addEventListener('click', () => {
  $('#question-form').style.display = 'none';
});

$('#update-question-btn').addEventListener('click', async () => {
  const text = $('#question-input').value.trim();
  if (!text || !currentQuestion) return;
  try {
    await api(`/api/question/${currentQuestion.id}`, { method: 'PUT', body: JSON.stringify({ text }) });
    $('#question-form').style.display = 'none';
    await loadQuestion();
    await loadArchive();
  } catch (err) {
    alert(err.message);
  }
});

$('#save-question-btn').addEventListener('click', async () => {
  const text = $('#question-input').value.trim();
  if (!text) return;
  try {
    await api('/api/question', { method: 'POST', body: JSON.stringify({ text }) });
    $('#question-form').style.display = 'none';
    $('#own-feedback').innerHTML = '';
    $('#essay-input').value = '';
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
    $('#own-feedback').innerHTML = '';
    await loadQuestion();
    await loadArchive();
    await loadOverall();
  } catch (err) {
    alert(err.message);
  }
});

// ---------- Essay submit ----------
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
    $('#own-feedback').innerHTML = renderScriptCard({
      name: 'Your result', status: 'graded', score: result.score,
      feedback: result, essay: text
    }, false);
    loadArchive();
    loadOverall();
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message;
    statusEl.className = 'status-text err';
  } finally {
    $('#submit-essay-btn').disabled = false;
  }
});

function dayLabel(i, createdAt) {
  if (i === 0) return 'Today';
  if (i === 1) return 'Yesterday';
  if (i === 2) return 'Day before yesterday';
  return new Date(createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

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

    const label = dayLabel(i, day.question.created_at);

    const head = document.createElement('div');
    head.className = 'archive-day-head';
    head.innerHTML = `
      <span class="day-stamp">${label}</span>
      <p class="question-text small">${escapeHtml(day.question.text)}</p>
      ${meIsAdmin ? `<button class="admin-delete-btn delete-day-btn">Delete this day</button>` : ''}
    `;
    section.appendChild(head);

    if (meIsAdmin) {
      head.querySelector('.delete-day-btn').addEventListener('click', async () => {
        if (!confirm(`Delete "${label}" entirely — the question and everyone's essays/grades for it? This cannot be undone. (Overall standing scores are unaffected.)`)) return;
        await api(`/api/question/${day.question.id}`, { method: 'DELETE' });
        await loadArchive();
        await loadQuestion();
      });
    }

    const grid = buildDayGrid(day);

    if (i === 0) {
      // Today: always expanded
      section.appendChild(grid);
    } else {
      // Past days: collapsed by default, click to view
      const details = document.createElement('details');
      details.className = 'essay-reveal day-details';
      const summary = document.createElement('summary');
      summary.textContent = `View this day's essays`;
      details.appendChild(summary);
      details.appendChild(grid);
      section.appendChild(details);
    }

    container.appendChild(section);
  });
}

function buildDayGrid(day) {
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
      card.className = 'script-card';
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

  return grid;
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

function renderScriptCard(entry, showAdminDelete) {
  const fb = entry.feedback || {};
  const band = fb.band || '';
  const rubric = fb.rubric || {};
  const checklist = fb.checklist || {};
  const stats = fb.statistics || {};
  const mistakes = fb.mistakes || [];
  const words = (fb.uncommon_words || []).map(w => `<span class="word-chip"><b>${escapeHtml(w.word)}</b> — ${escapeHtml(w.meaning)}</span>`).join('');

  const essayHtml = entry.essay ? `
    <details class="essay-reveal">
      <summary>Read the essay</summary>
      <p class="essay-text">${escapeHtml(entry.essay)}</p>
    </details>` : '';

  const rubricHtml = Object.keys(RUBRIC_LABELS).map(key => {
    const r = rubric[key] || { score: 0, notes: '' };
    const pct = Math.round((r.score / 10) * 100);
    return `
      <div class="rubric-row">
        <div class="rubric-row-top">
          <span class="rubric-label">${RUBRIC_LABELS[key]}</span>
          <span class="rubric-score">${r.score}<small>/10</small></span>
        </div>
        <div class="rubric-bar"><div class="rubric-bar-fill" style="width:${pct}%"></div></div>
        ${r.notes ? `<p class="rubric-notes">${escapeHtml(r.notes)}</p>` : ''}
      </div>`;
  }).join('');

  const checklistHtml = Object.keys(CHECKLIST_LABELS).map(key => `
    <span class="check-item ${checklist[key] ? 'yes' : 'no'}">${checklist[key] ? '✓' : '✕'} ${CHECKLIST_LABELS[key]}</span>
  `).join('');

  const statsHtml = `
    <span class="stat-chip">${stats.word_count ?? '—'} words</span>
    <span class="stat-chip">${stats.paragraph_count ?? '—'} paragraphs</span>
    <span class="stat-chip">${stats.sentence_count ?? '—'} sentences</span>
    <span class="stat-chip">avg ${stats.avg_sentence_length ?? '—'} words/sentence</span>
    <span class="stat-chip">~${Math.max(1, Math.round((stats.reading_time_seconds || 0) / 60)) || '<1'} min read</span>
  `;

  const mistakesHtml = mistakes.length
    ? mistakes.map(m => `
        <div class="mistake-item sev-${(m.severity || 'minor').toLowerCase()}">
          <span class="sev-badge">${escapeHtml(m.severity || 'Minor')}</span>
          ${m.original ? `<p class="mistake-original">“${escapeHtml(m.original)}”</p>` : ''}
          ${m.issue ? `<p class="mistake-issue">${escapeHtml(m.issue)}</p>` : ''}
          ${m.improved ? `<p class="mistake-improved">→ ${escapeHtml(m.improved)}</p>` : ''}
        </div>`).join('')
    : '<p class="no-mistakes">No grammar issues found.</p>';

  return `
    <div class="score-mark">${entry.score}<small>/ 40</small></div>
    <p class="fb-name">${entry.name || ''}</p>
    <p class="fb-status">Graded${band ? ` · <span class="band-tag">${escapeHtml(band)}</span>` : ''}${fb.essay_type_detected ? ` · ${escapeHtml(fb.essay_type_detected)}` : ''}</p>
    ${essayHtml}

    <div class="fb-section rubric">
      <h4>Rubric breakdown</h4>
      ${rubricHtml}
    </div>

    <div class="fb-section stats">
      <h4>Statistics</h4>
      <div class="stat-row">${statsHtml}</div>
    </div>

    <div class="fb-section checklist">
      <h4>Handbook checklist</h4>
      <div class="check-grid">${checklistHtml}</div>
    </div>

    ${fb.examiner_comment ? `
    <div class="fb-section examiner">
      <h4>Examiner's comment</h4>
      <p class="examiner-text">${escapeHtml(fb.examiner_comment)}</p>
    </div>` : ''}

    ${(fb.format_notes || []).length ? `
    <div class="fb-section format-notes">
      <h4>Format note</h4>
      <ul>${fb.format_notes.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>
    </div>` : ''}

    <div class="fb-section strengths">
      <h4>What's good</h4>
      <ul>${(fb.strengths || []).map(s => `<li>${escapeHtml(s)}</li>`).join('') || '<li>—</li>'}</ul>
    </div>

    <div class="fb-section mistakes">
      <h4>Grammar analysis</h4>
      ${mistakesHtml}
    </div>

    <div class="fb-section improvements">
      <h4>Needs improvement</h4>
      <ul>${(fb.improvements || []).map(s => `<li>${escapeHtml(s)}</li>`).join('') || '<li>—</li>'}</ul>
    </div>

    ${words ? `<div class="fb-section words"><h4>Advanced words used</h4>${words}</div>` : ''}
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
