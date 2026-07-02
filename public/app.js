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

function renderScriptCard(entry, showAdminDelete) {
  const fb = entry.feedback || {};
  const words = (fb.uncommon_words || []).map(w => `<span class="word-chip"><b>${escapeHtml(w.word)}</b> — ${escapeHtml(w.meaning)}</span>`).join('');
  const essayHtml = entry.essay ? `
    <details class="essay-reveal">
      <summary>Read the essay</summary>
      <p class="essay-text">${escapeHtml(entry.essay)}</p>
    </details>` : '';
  return `
    <div class="score-mark">${entry.score}<small>/ 40</small></div>
    <p class="fb-name">${entry.name || ''}</p>
    <p class="fb-status">Graded</p>
    ${essayHtml}
    <div class="fb-section strengths">
      <h4>What's good</h4>
      <ul>${(fb.strengths || []).map(s => `<li>${escapeHtml(s)}</li>`).join('') || '<li>—</li>'}</ul>
    </div>
    <div class="fb-section mistakes">
      <h4>Mistakes</h4>
      <ul>${(fb.mistakes || []).map(s => `<li>${escapeHtml(s)}</li>`).join('') || '<li>—</li>'}</ul>
    </div>
    <div class="fb-section improvements">
      <h4>Needs improvement</h4>
      <ul>${(fb.improvements || []).map(s => `<li>${escapeHtml(s)}</li>`).join('') || '<li>—</li>'}</ul>
    </div>
    ${words ? `<div class="fb-section words"><h4>Uncommon words used</h4>${words}</div>` : ''}
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
