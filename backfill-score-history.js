// backfill-score-history.js
//
// One-time script: copies scores from every currently-existing graded essay
// into the new `score_history` table, so nothing already scored is lost
// when the next prune happens.
//
// Run this ONCE, after deploying the updated db.js/server.js but before
// the next question gets set (which is what triggers a prune):
//
//   node backfill-score-history.js
//
// Safe to run more than once — it uses ON CONFLICT DO UPDATE, so re-running
// just re-syncs, it won't create duplicates or double-count anything.

require('dotenv').config();
const { init, all, run } = require('./db');

async function main() {
  await init(); // makes sure score_history table exists

  const rows = await all(`
    SELECT question_id, username, score
    FROM essays
    WHERE status = 'graded' AND score IS NOT NULL
  `);

  if (rows.length === 0) {
    console.log('No graded essays found — nothing to backfill.');
    return;
  }

  let count = 0;
  for (const r of rows) {
    await run(`
      INSERT INTO score_history (question_id, username, score)
      VALUES (?, ?, ?)
      ON CONFLICT(question_id, username) DO UPDATE SET
        score = excluded.score
    `, [r.question_id, r.username, r.score]);
    count++;
  }

  console.log(`Backfilled ${count} score(s) into score_history.`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });
