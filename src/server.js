import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import QRCode from 'qrcode';
import { startBot, getSock, getLatestQr, getConnectionStatus } from './bot.js';
import { initSheets } from './sheets.js';
import { startSchedulers } from './jobs/scheduler.js';
import { dailyRanking } from './calc.js';
import { todayDate } from './util.js';

const app = express();
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ ok: true, bot: !!getSock(), status: getConnectionStatus(), time: new Date().toISOString() });
});

// Live QR page — auto-refreshes until the bot connects, then shows success.
app.get('/qr', async (req, res) => {
  const status = getConnectionStatus();
  const qr = getLatestQr();

  if (status === 'connected') {
    return res.send(`<!doctype html><html><head><meta charset="utf-8"><title>HOF Bot</title>
<style>body{font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#0b0b0b;color:#eaeaea}</style>
</head><body><div style="text-align:center"><h1>Bot connected</h1><p>You can close this tab.</p></div></body></html>`);
  }

  let dataUrl = null;
  if (qr) {
    try { dataUrl = await QRCode.toDataURL(qr, { margin: 1, scale: 8 }); } catch {}
  }

  res.send(`<!doctype html><html><head><meta charset="utf-8"><title>HOF Bot — Scan QR</title>
<meta http-equiv="refresh" content="3">
<style>
  body{font-family:system-ui;display:grid;place-items:center;min-height:100vh;margin:0;background:#0b0b0b;color:#eaeaea}
  .card{text-align:center;padding:32px;border:1px solid #222;border-radius:16px;background:#111}
  img{background:#fff;padding:12px;border-radius:8px}
  .muted{color:#888;font-size:14px;margin-top:12px}
  .pill{display:inline-block;padding:4px 10px;border-radius:999px;background:#1c1c1c;border:1px solid #333;font-size:12px;margin-bottom:16px;text-transform:uppercase;letter-spacing:0.05em}
</style></head>
<body><div class="card">
  <div class="pill">${status}</div>
  <h1>Scan to link bot WhatsApp</h1>
  ${dataUrl
    ? `<img src="${dataUrl}" width="320" height="320" alt="QR">`
    : `<p>Waiting for QR... if this persists for a minute, restart the server.</p>`}
  <div class="muted">Page auto-refreshes every 3 seconds.</div>
  <div class="muted">Open WhatsApp → Settings → Linked Devices → Link a device.</div>
</div></body></html>`);
});

// Open all QR variants in separate tabs (one per group/store admin needs to see).
// Placeholder for future use — for now just provides a quick index page.
app.get('/', (req, res) => {
  const port = process.env.PORT || 3001;
  res.send(`<!doctype html><html><head><meta charset="utf-8"><title>HOF Admin</title>
<style>body{font-family:system-ui;padding:32px;background:#0b0b0b;color:#eaeaea}a{color:#7ab7ff;display:block;margin:8px 0}</style>
</head><body>
<h1>HOF Admin</h1>
<a href="/qr" target="_blank">Scan WhatsApp QR</a>
<a href="/health" target="_blank">Health</a>
<a href="/admin/groups?secret=${process.env.ADMIN_SECRET || ''}" target="_blank">List groups (after bot connects)</a>
<a href="/admin/ranking?secret=${process.env.ADMIN_SECRET || ''}" target="_blank">Today's ranking</a>
<a href="/admin/relogin?secret=${process.env.ADMIN_SECRET || ''}" target="_blank">Reset session (wipe auth + new QR)</a>
</body></html>`);
});

// One-shot helper after the bot joins groups: prints all group JIDs to logs.
// Call: GET /admin/groups?secret=...
app.get('/admin/groups', async (req, res) => {
  if (process.env.ADMIN_SECRET && req.query.secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const sock = getSock();
  if (!sock) return res.status(503).json({ error: 'bot not ready' });
  const groups = await sock.groupFetchAllParticipating();
  const list = Object.values(groups).map((g) => ({ jid: g.id, name: g.subject }));
  res.json(list);
});

// Wipe the WhatsApp auth folder and restart the process. Railway restart policy
// brings the container back up immediately, after which /qr shows a fresh code.
app.get('/admin/relogin', (req, res) => {
  if (process.env.ADMIN_SECRET && req.query.secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const authDir = path.resolve('auth');
  try {
    if (fs.existsSync(authDir)) {
      for (const f of fs.readdirSync(authDir)) {
        fs.rmSync(path.join(authDir, f), { recursive: true, force: true });
      }
    }
    res.json({ ok: true, message: 'auth cleared, restarting — open /qr in ~5s' });
    setTimeout(() => process.exit(0), 500);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/admin/ranking', (req, res) => {
  if (process.env.ADMIN_SECRET && req.query.secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const date = req.query.date || todayDate();
  res.json({ date, rows: dailyRanking(date) });
});

const PORT = process.env.PORT || 3001;

(async () => {
  await initSheets();
  await startBot();
  startSchedulers();

  // Print whitelist for sanity-check on boot.
  const { STORES, MANAGER_GROUP_JID, OWNERS } = await import('./config.js');
  console.log('[config] owners:', OWNERS.length ? OWNERS.join(', ') : '(none — set OWNERS in .env)');
  console.log('[config] manager group:', MANAGER_GROUP_JID || '(none — set MANAGER_GROUP_JID in .env)');
  console.log('[config] stores active:', STORES.length
    ? STORES.map((s) => `${s.key}=${s.groupJid}`).join('\n  ')
    : '(none — set STORE_*_JID in .env)');

  app.listen(PORT, () => console.log(`[server] listening on ${PORT}`));
})();
