# Answer Script — Essay Practice App

A private 4-person essay practice tool for BRAC/NSU admission prep.

- One shared question at a time, set by anyone logged in.
- Each of the 4 accounts writes and submits their own essay for that question.
- Gemini grades each essay out of 40 and returns: what's good, mistakes,
  what to improve, and uncommon/advanced vocabulary used — with meanings.
- All 4 results are shown together on a shared leaderboard, plus a running
  "overall standing" table (average score across every essay, all-time).

## 1. Install

Requires **Node.js 22.5 or newer** (uses the built-in `node:sqlite` module —
no native database dependency to compile, so it installs cleanly on any host).

```bash
npm install
```

## 2. Configure

```bash
cp .env.example .env
```

Open `.env` and fill in:

- `GEMINI_API_KEY` — get a free key at https://aistudio.google.com/apikey
  (the free tier is more than enough for 4 people submitting one essay a day)
- `SESSION_SECRET` — any random long string (used to sign login cookies)

The 4 login accounts are hardcoded in `server.js` (search for `USERS`):

```
ifaz / olddhaka
zuhayr / suraiya
tnan / roblox
farhan / efootball
```

Edit that list directly in `server.js` if you ever want to change a
username or password — there's no signup flow by design.

## 3. Run locally

```bash
npm start
```

Visit `http://localhost:3000`, log in with one of the 4 accounts.

## 4. Deploy

This is a plain Node/Express app. For the database, it uses **libSQL**
(SQLite-compatible) which runs two ways:

- **Locally**: automatically uses a local file at `./data/local.db` — zero
  setup.
- **In production on a host with no persistent disk** (like Render's free
  tier): points at a free hosted database instead, so your data survives
  restarts/redeploys/spin-downs without needing a paid disk.

**Set up the free cloud database (only needed for deployment, skip for local use):**
1. Go to https://turso.tech, sign up (free tier is generous — plenty for 4
   people submitting one essay a day).
2. Install their CLI and run:
   ```bash
   turso db create essay-app
   turso db show essay-app --url
   turso db tokens create essay-app
   ```
3. Copy the URL and token — you'll paste these into your host's environment
   variables as `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`.

**Render (recommended, free tier works — no disk needed):**
1. Push this folder to a GitHub repo (`.env` and the `data/` folder are
   already gitignored, so secrets and your local database won't leak).
2. Create a new Web Service, connect the repo.
3. Build command: `npm install` — Start command: `npm start`
4. Add these environment variables in the host's dashboard:
   - `GEMINI_API_KEY`
   - `SESSION_SECRET` (any random long string)
   - `TURSO_DATABASE_URL`
   - `TURSO_AUTH_TOKEN`
5. Deploy — no disk to configure at all.

**Any VPS (e.g. a cheap DigitalOcean droplet):**
```bash
git clone <your-repo>
cd essay-app
npm install
cp .env.example .env   # fill in values (Turso optional here — a VPS disk
                        # persists fine on its own, so you can leave the
                        # Turso vars blank and it'll use a local file)
npm install -g pm2
pm2 start server.js --name essay-app
```

## How it works

- `server.js` — Express app: login/session, question-of-the-day, essay
  submission, leaderboard, overall stats.
- `db.js` — SQLite schema (2 tables: `questions`, `essays`).
- `gemini.js` — builds the grading prompt and calls the Gemini API,
  returns a clean JSON object `{score, strengths, mistakes, improvements,
  uncommon_words}`.
- `public/` — the frontend (plain HTML/CSS/JS, no build step).

## Notes

- **Farhan is the admin.** Only Farhan can set/change the question of the day,
  delete a question entirely, or delete anyone's essay. The other 3 accounts
  can only write and submit their own essay.
- **Only today + yesterday are kept.** Every time the admin sets a new
  question, the oldest saved question (and everyone's essays for it) is
  automatically deleted, so only the 2 most recent questions ever exist in
  the database.
- **"Marked Scripts" tab** is where all saved essays live — both today's and
  yesterday's question, everyone's essay (click "Read the essay" to expand
  it), and the AI's full marking for each. This replaced the old
  "leaderboard" — scores aren't ranked here, just shown per person; overall
  ranking lives in the separate "Overall standing" tab.
- Submitting an essay again for the same question **overwrites** your
  previous answer and re-grades it (useful if you catch a typo).
- If a grading call fails (bad API key, network issue, rate limit), the
  essay text is still saved — nothing is lost, you just resubmit to retry.
- Grading is calibrated for a short ~220-280 word, 4-5 paragraph admission
  essay (see the prompt in `gemini.js`) — it won't penalize you for not
  writing a long-form academic essay.
- Switching from Gemini to Claude later only means rewriting `gemini.js`
  (same input/output shape) — nothing else needs to change.
