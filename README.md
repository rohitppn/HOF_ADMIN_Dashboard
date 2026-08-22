# HOF ADMIN

WhatsApp ops bot + web dashboard for House of Fett. Store managers post sales
updates into one WhatsApp group; the bot filters by sender, parses each message
with Claude, writes to Supabase Postgres + Google Sheets, and posts daily
rankings. A React dashboard visualises everything with filters and analytics.

## Stack

- **Node 20** — Baileys (WhatsApp Web), Anthropic Claude Haiku 4.5, Express, node-cron
- **Supabase (Postgres)** — source of truth for stores + all sales data
- **Google Sheets** — optional mirror for owner visibility
- **Vite + React + Recharts** — dashboard SPA
- **Docker** — Railway-friendly container
- **GitHub Actions** — auto-deploys dashboard to GitHub Pages

## Feature overview

- **Sender-filtered ingest** — only messages from listed store phones hit Claude
- **Live store CRUD** — add / remove stores from the dashboard, no restart
- **Hourly @mention prompts** — bot pings every manager at 1/3/5/7/9 PM
- **Manual broadcast** — send a WhatsApp message to a whitelisted group from the dashboard
- **Live QR page** — link WhatsApp from the browser, no terminal
- **Analytics** — momentum trend, week-over-week, top/worst days, big-bill distribution, peak-hour per store, target-hit streaks
- **Owner Q&A** — natural language questions in the leadership group return summaries + CSV files

## First-time setup

1. **Supabase**
   - Create project → **SQL Editor** → paste [`sql/001_init.sql`](sql/001_init.sql) → Run
   - Repeat with [`sql/002_stores.sql`](sql/002_stores.sql)
   - **Settings → API** → copy URL + anon key + service_role key

2. **`.env`** (copy `.env.example`) — required:
   - `ANTHROPIC_API_KEY`
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
   - `ADMIN_SECRET` — `openssl rand -hex 24`
   - `OWNERS` — owner phone numbers (with country code, comma-separated)
   - `MAIN_GROUP_JID` — leave blank at first; fill in after linking WhatsApp
   - Optional: `GOOGLE_*` (for Sheets mirror), `MANAGER_GROUP_JID` (if separate from main)

3. **Install + run**
   ```bash
   npm install
   npm start
   ```
   Open http://localhost:3001/ → Scan QR → Dashboard → **WhatsApp** tab → copy the main group JID → paste into `.env` as `MAIN_GROUP_JID` → restart.

4. **Seed stores**
   - The bot seeds the `stores` table on first boot if a `src/seed-stores.js` file exists (gitignored — you write your own with your real store phones). Otherwise the table stays empty and you add each store via the **Manage stores** tab.

## Deploying

### Option A — Railway (recommended)

1. Push this repo to GitHub.
2. Railway → New Project → **Deploy from GitHub repo** → pick this repo.
3. Add every variable from your `.env` in Railway's **Variables** tab.
4. Deploy. Open `https://<app>.up.railway.app/qr` to link WhatsApp, then use `/dashboard/`.

Persistent WhatsApp session: mount a Railway volume at `/app/auth` so the session survives redeploys.

### Option B — GitHub Pages (dashboard) + Railway (backend)

Two deploys, one URL for the site, another for the bot.

1. Do the Railway deploy above. Note the Railway URL.
2. On Railway, add env var: `ALLOWED_ORIGINS=https://<your-github-username>.github.io`
3. In this GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `RAILWAY_API_URL`
   - Value: `https://<your-app>.up.railway.app`
4. In this GitHub repo: **Settings → Pages → Source → GitHub Actions**
5. Push to `main`. The [`.github/workflows/pages.yml`](.github/workflows/pages.yml) workflow builds the dashboard with the correct base path + API URL and publishes to Pages.
6. Dashboard lives at `https://<your-github-username>.github.io/<repo-name>/`.

## HTTP surface

| Path | Purpose |
|---|---|
| `/` | Landing page with quick links |
| `/qr` | WhatsApp linking page (auto-refresh) |
| `/health` | JSON heartbeat |
| `/dashboard/` | React dashboard (Railway build) |
| `/dashboard-api/*` | JSON API (header `x-admin-secret`) |
| `/admin/groups` | List WhatsApp groups the bot is in |
| `/admin/ranking` | Today's ranking (JSON) |
| `/admin/relogin` | Wipe `auth/` and force a new QR |

## Data model

| Table | Purpose |
|---|---|
| `stores` | Store list — key, name, phone, targets, active flag |
| `opening_balance` | Cash on hand at day open, per store |
| `store_open` | When each store opened (flagged if past 10:30) |
| `hourly_sales` | Slot-bucketed sales updates |
| `big_bills` | High-value bills (₹25k+) |
| `grooming` | Daily grooming/uniform compliance |
| `dsr` | End-of-day (or cumulative running total) sales |
| `message_log` | Every message the bot processed, with parsed intent |

## Dashboard tabs

- **Overview** — KPIs + daily trend + sales-share pie + per-store bar
- **Analytics** — momentum with 7-day MA, WoW comparison, top/worst days, big-bill distribution, peak-hour per store, target streaks
- **Store perf.** — achievement % + consistency % bar charts + detailed table
- **Hourly** — grouped bar chart + heatmap
- **Big bills** — sortable table
- **Missing reports** — per-section breakdown for a given date
- **Message log** — raw WhatsApp messages with intent filter
- **Send message** — manual broadcast (whitelisted groups only)
- **WhatsApp** — status, live QR, groups list with click-to-copy JIDs
- **Manage stores** — add / remove stores (bot picks up changes live)

## Local dev — dashboard hot reload

```bash
# Terminal 1
npm start                          # bot + Express on :3001

# Terminal 2
cd dashboard && npm run dev        # Vite on :5173 (proxies /dashboard-api to :3001)
```
