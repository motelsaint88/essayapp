require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const { init, get, all, run } = require('./db');
const { gradeEssay } = require('./gemini');

const app = express();
const PORT = process.env.PORT || 3000;

// ---- Hardcoded accounts (4 fixed users, no signup) ----
const USERS = [
  { username: 'ifaz',   password: 'olddhaka',  name: 'Ifaz' },
  { username: 'zuhayr', password: 'suraiya',   name: 'Zuhayr' },
  { username: 'tnan',   password: 'roblox',    name: 'Tnan' },
  { username: 'farhan', password: 'efootball', name: 'Farhan' }
];
const USERNAMES = USERS.map(u => u.username);
const ADMIN_USERNAME = 'farhan'; // only this account can set questions and delete essays
const MAX_QUESTIONS_KEPT = 2; // today + yesterday only

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-secret-in-env',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 30 } // 30 days
}));

function requireAuth(req, res, next) {
  if (!req.session.username) return res.status(401).json({ error: 'Not logged in' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.username) return res.status(401).json({ error: 'Not logged in' });
  if (req.session.username !== ADMIN_USERNAME) return res.status(403).json({ error: 'Only the admin can do this' });
  next();
}

function displayName(username) {
  const u = USERS.find(u => u.username === username);
  return u ? u.name : username;
}

// keeps only the most recent MAX_QUESTIONS_KEPT questions (and their essays)
async function pruneOldQuestions() {
  const keep = await all('SELECT id FROM questions ORDER BY id DESC LIMIT ?', [MAX_QUESTIONS_KEPT]);
  const keepIds = keep.map(r => r.id);
  if (keepIds.length === 0) return;
  const placeholders = keepIds.map(() => '?').join(',');
  await run(`DELETE FROM essays WHERE question_id NOT IN (${placeholders})`, keepIds);
  await run(`DELETE FROM questions WHERE id NOT IN (${placeholders})`, keepIds);
}

// wraps an async route handler so thrown errors become a 500 instead of hanging
function h(fn) {
  return (req, res) => fn(req, res).catch(err => {
    console.error(err);
    res.status(500).json({ error: err.message || 'Server error' });
  });
}

// ---------- Auth ----------
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = USERS.find(u => u.username === username && u.password === password);
  if (!user) return res.status(401).json({ error: 'Wrong username or password' });
  req.session.username = user.username;
  res.json({ username: user.username, name: user.name });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (!req.session.username) return res.json({ username: null });
  res.json({
    username: req.session.username,
    name: displayName(req.session.username),
    isAdmin: req.session.username === ADMIN_USERNAME
  });
});

// ---------- Question of the day ----------
app.get('/api/question', requireAuth, h(async (req, res) => {
  const q = await get('SELECT * FROM questions WHERE is_active = 1 ORDER BY id DESC LIMIT 1');
  res.json({ question: q || null });
}));

app.post('/api/question', requireAdmin, h(async (req, res) => {
  const { text } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'Question text is required' });

  await run('UPDATE questions SET is_active = 0 WHERE is_active = 1');
  const info = await run('INSERT INTO questions (text, created_by) VALUES (?, ?)', [text.trim(), req.session.username]);
  await pruneOldQuestions();
  const q = await get('SELECT * FROM questions WHERE id = ?', [info.lastInsertRowid]);
  res.json({ question: q });
}));

app.get('/api/history', requireAuth, h(async (req, res) => {
  const rows = await all('SELECT * FROM questions ORDER BY id DESC LIMIT 30');
  res.json({ questions: rows });
}));

// ---------- Essays ----------
app.post('/api/essay', requireAuth, h(async (req, res) => {
  const { questionId, text } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'Essay text is required' });

  const q = questionId
    ? await get('SELECT * FROM questions WHERE id = ?', [questionId])
    : await get('SELECT * FROM questions WHERE is_active = 1 ORDER BY id DESC LIMIT 1');

  if (!q) return res.status(400).json({ error: 'No question has been set yet' });

  const username = req.session.username;

  // upsert placeholder row as "pending"
  await run(`
    INSERT INTO essays (question_id, username, essay_text, status)
    VALUES (?, ?, ?, 'pending')
    ON CONFLICT(question_id, username) DO UPDATE SET
      essay_text = excluded.essay_text, status = 'pending', score = NULL, feedback = NULL
  `, [q.id, username, text.trim()]);

  try {
    const result = await gradeEssay(q.text, text.trim());
    await run(`
      UPDATE essays SET score = ?, feedback = ?, status = 'graded'
      WHERE question_id = ? AND username = ?
    `, [result.score, JSON.stringify(result), q.id, username]);

    res.json({ ok: true, questionId: q.id, ...result });
  } catch (err) {
    await run(`UPDATE essays SET status = 'error' WHERE question_id = ? AND username = ?`, [q.id, username]);
    console.error('Grading failed:', err.message);
    res.status(500).json({ error: 'Grading failed: ' + err.message });
  }
}));

app.post('/api/essay/regrade', requireAuth, h(async (req, res) => {
  const { questionId } = req.body || {};
  const username = req.session.username;
  const row = await get('SELECT * FROM essays WHERE question_id = ? AND username = ?', [questionId, username]);
  if (!row) return res.status(404).json({ error: 'No essay found to regrade' });
  const q = await get('SELECT * FROM questions WHERE id = ?', [questionId]);

  try {
    const result = await gradeEssay(q.text, row.essay_text);
    await run(`UPDATE essays SET score = ?, feedback = ?, status = 'graded' WHERE id = ?`,
      [result.score, JSON.stringify(result), row.id]);
    res.json({ ok: true, questionId: q.id, ...result });
  } catch (err) {
    await run(`UPDATE essays SET status = 'error' WHERE id = ?`, [row.id]);
    res.status(500).json({ error: 'Grading failed: ' + err.message });
  }
}));

app.delete('/api/essay/:questionId/:username', requireAdmin, h(async (req, res) => {
  const { questionId, username } = req.params;
  const info = await run('DELETE FROM essays WHERE question_id = ? AND username = ?', [questionId, username]);
  if (info.changes === 0) return res.status(404).json({ error: 'No essay found to delete' });
  res.json({ ok: true });
}));

app.delete('/api/question/:questionId', requireAdmin, h(async (req, res) => {
  const { questionId } = req.params;
  await run('DELETE FROM essays WHERE question_id = ?', [questionId]);
  const info = await run('DELETE FROM questions WHERE id = ?', [questionId]);
  if (info.changes === 0) return res.status(404).json({ error: 'Question not found' });
  res.json({ ok: true });
}));

// ---------- Saved essays (today + yesterday, admin can delete) ----------
app.get('/api/archive', requireAuth, h(async (req, res) => {
  const questions = await all('SELECT * FROM questions ORDER BY id DESC LIMIT ?', [MAX_QUESTIONS_KEPT]);

  const archive = [];
  for (const q of questions) {
    const rows = await all('SELECT * FROM essays WHERE question_id = ?', [q.id]);
    const byUser = Object.fromEntries(rows.map(r => [r.username, r]));

    const entries = USERNAMES.map(username => {
      const r = byUser[username];
      if (!r) return { username, name: displayName(username), status: 'not_submitted' };
      return {
        username,
        name: displayName(username),
        status: r.status,
        score: r.score,
        essay: r.essay_text,
        feedback: r.feedback ? JSON.parse(r.feedback) : null,
        submittedAt: r.created_at
      };
    });

    archive.push({ question: q, entries });
  }

  res.json({ archive });
}));

app.get('/api/overall', requireAuth, h(async (req, res) => {
  const rows = await all(`
    SELECT username, COUNT(*) as essays, SUM(score) as total, AVG(score) as avg
    FROM essays WHERE status = 'graded' GROUP BY username
  `);
  const byUser = Object.fromEntries(rows.map(r => [r.username, r]));

  const overall = USERNAMES.map(username => {
    const r = byUser[username];
    return {
      username,
      name: displayName(username),
      essays: r ? r.essays : 0,
      total: r ? r.total : 0,
      avg: r ? Math.round(r.avg * 10) / 10 : 0
    };
  }).sort((a, b) => b.avg - a.avg);

  res.json({ overall });
}));

// ---------- Boot ----------
init()
  .then(() => {
    app.listen(PORT, () => console.log(`Essay grading app running on http://localhost:${PORT}`));
  })
  .catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
