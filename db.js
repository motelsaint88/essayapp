// db.js — uses libSQL (SQLite-compatible).
//
// Local development: no setup needed, writes to ./data/local.db automatically.
// Production (e.g. Render free tier, which has no persistent disk): set
// TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in your environment to point at a
// free Turso database instead — same SQL, just stored in the cloud so it
// survives restarts/redeploys/spin-downs.
const { createClient } = require('@libsql/client');
const path = require('path');
const fs = require('fs');

const isRemote = !!process.env.TURSO_DATABASE_URL;

let url;
if (isRemote) {
  url = process.env.TURSO_DATABASE_URL;
} else {
  const dataDir = path.join(__dirname, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  url = `file:${path.join(dataDir, 'local.db')}`;
}

const client = createClient(
  isRemote ? { url, authToken: process.env.TURSO_AUTH_TOKEN } : { url }
);

async function init() {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      is_active INTEGER NOT NULL DEFAULT 1
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS essays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      essay_text TEXT NOT NULL,
      score INTEGER,
      feedback TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(question_id, username)
    )
  `);
}

async function get(sql, args = []) {
  const r = await client.execute({ sql, args });
  return r.rows[0];
}

async function all(sql, args = []) {
  const r = await client.execute({ sql, args });
  return r.rows;
}

async function run(sql, args = []) {
  const r = await client.execute({ sql, args });
  return { lastInsertRowid: Number(r.lastInsertRowid), changes: Number(r.rowsAffected) };
}

module.exports = { client, init, isRemote, get, all, run };
