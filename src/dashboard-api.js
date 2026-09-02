// Read-only JSON API consumed by /dashboard (the Vite build).
// Gated by ADMIN_SECRET sent as x-admin-secret header (dashboard SPA stores it in localStorage).
// All reads go through supabase.js — dashboard never talks to Supabase directly.

import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import { queries } from './supabase.js';
import {
  STORES, storeByKey, HOURLY_SLOTS, isAllowedGroup, MANAGER_GROUP_JID,
  addStore, deactivateStore, reactivateStore, listAllStores,
} from './config.js';
import { dailyRanking, consistencyScore, missingReports } from './calc.js';
import { todayDate, nowIso } from './util.js';
import { getSock, getLatestQr, getConnectionStatus } from './bot.js';
import { findUser, verifyPassword, signToken, verifyToken, updateLastLogin } from './auth.js';

export const dashboardApi = express.Router();
dashboardApi.use(express.json());

// CORS — needed when the dashboard is hosted on GitHub Pages and the backend
// is on Railway (cross-origin). ALLOWED_ORIGINS is comma-separated in .env,
// e.g. "https://rohitppn.github.io,http://localhost:5173"
// Empty ⇒ same-origin only (Railway single-URL deploy).
const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)
);
dashboardApi.use((req, res, next) => {
  const origin = req.get('origin');
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization, x-admin-secret');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Login is public — everything else needs a Bearer token (or the legacy
// x-admin-secret header for backwards-compat with scripts / /admin/* URLs).
dashboardApi.post('/login', async (req, res) => {
  const email = String(req.body?.email || '').toLowerCase().trim();
  const password = String(req.body?.password || '');
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  const user = await findUser(email);
  if (!user || !verifyPassword(password, user.password_hash, user.salt)) {
    return res.status(401).json({ error: 'invalid email or password' });
  }
  const token = signToken({ email: user.email });
  updateLastLogin(user.email).catch(() => {});
  res.json({ token, email: user.email });
});

dashboardApi.use((req, res, next) => {
  const bearer = (req.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (bearer) {
    const payload = verifyToken(bearer);
    if (payload) { req.user = payload; return next(); }
  }
  const secret = req.get('x-admin-secret') || req.query.secret;
  if (secret && process.env.ADMIN_SECRET && secret === process.env.ADMIN_SECRET) return next();
  return res.status(401).json({ error: 'unauthorized' });
});

// After auth — who am I?
dashboardApi.get('/me', (req, res) => res.json({ email: req.user?.email || null }));

const wrap = (fn) => async (req, res) => {
  try { res.json(await fn(req)); }
  catch (e) { console.error('[dashboard-api]', req.path, e.message); res.status(500).json({ error: e.message }); }
};

// --- meta ---

dashboardApi.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

dashboardApi.get('/stores', (req, res) => res.json({
  stores: STORES.map((s) => ({ key: s.key, name: s.name, dailyTarget: s.dailyTarget, hourlyTarget: s.hourlyTarget })),
  hourlySlots: HOURLY_SLOTS.map((s) => `${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`),
}));

// --- range-based reads (from, to, optional store_key) ---

function range(req) {
  const to = req.query.to || todayDate();
  const from = req.query.from || to;
  const store = req.query.store || null;
  return { from, to, store };
}

// KPIs + daily trend for the range.
dashboardApi.get('/overview', wrap(async (req) => {
  const { from, to, store } = range(req);
  const [dsr, hourly, bigBills] = await Promise.all([
    queries.dsrRange(from, to),
    queries.hourlyRange(from, to),
    queries.bigBillsRange(from, to),
  ]);

  const dsrFiltered   = store ? dsr.filter((r) => r.store_key === store)      : dsr;
  const hourlyFiltered = store ? hourly.filter((r) => r.store_key === store)  : hourly;
  const bbFiltered    = store ? bigBills.filter((r) => r.store_key === store) : bigBills;

  // Prefer DSR per (store,date); fall back to hourly aggregate for days without DSR.
  const perDay = new Map(); // date -> { sales, bills, walkins }
  const dsrByKey = new Map(dsrFiltered.map((r) => [`${r.store_key}|${r.date}`, r]));
  const hourlyByKey = new Map();
  for (const r of hourlyFiltered) {
    const k = `${r.store_key}|${r.date}`;
    const m = hourlyByKey.get(k) ?? { sales: 0, bills: 0, walkins: 0 };
    m.sales += r.sales || 0; m.bills += r.bills || 0; m.walkins += r.walkins || 0;
    hourlyByKey.set(k, m);
  }
  const keys = new Set([...dsrByKey.keys(), ...hourlyByKey.keys()]);
  for (const key of keys) {
    const [, date] = key.split('|');
    const d = dsrByKey.get(key);
    const h = hourlyByKey.get(key);
    const sales = d?.total_sales ?? h?.sales ?? 0;
    const bills = d?.total_bills ?? h?.bills ?? 0;
    const walkins = d?.walkins ?? h?.walkins ?? 0;
    const m = perDay.get(date) ?? { sales: 0, bills: 0, walkins: 0 };
    m.sales += sales; m.bills += bills; m.walkins += walkins;
    perDay.set(date, m);
  }

  const daily = Array.from(perDay.entries())
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const kpi = daily.reduce((a, r) => ({
    sales: a.sales + r.sales,
    bills: a.bills + r.bills,
    walkins: a.walkins + r.walkins,
  }), { sales: 0, bills: 0, walkins: 0 });
  kpi.conversion = kpi.walkins ? Number(((kpi.bills / kpi.walkins) * 100).toFixed(1)) : null;
  kpi.bigBillCount = bbFiltered.length;
  kpi.bigBillTotal = bbFiltered.reduce((a, r) => a + (r.amount || 0), 0);

  // Sales share per store — for pie chart.
  const perStore = new Map();
  for (const key of keys) {
    const [storeKey] = key.split('|');
    const d = dsrByKey.get(key);
    const h = hourlyByKey.get(key);
    const sales = d?.total_sales ?? h?.sales ?? 0;
    perStore.set(storeKey, (perStore.get(storeKey) ?? 0) + sales);
  }
  const share = STORES
    .filter((s) => !store || s.key === store)
    .map((s) => ({ store: s.name, store_key: s.key, sales: perStore.get(s.key) ?? 0 }));

  return { from, to, store, kpi, daily, share };
}));

// Per-store achievement + consistency for the range.
dashboardApi.get('/stores/performance', wrap(async (req) => {
  const { from, to } = range(req);
  const consistency = await consistencyScore(from, to);
  const days = daysBetween(from, to);
  const perStore = STORES.map((s) => {
    const c = consistency.find((x) => x.store === s.name);
    const totalTarget = s.dailyTarget * days;
    return {
      store: s.name,
      store_key: s.key,
      dailyTarget: s.dailyTarget,
      days: c?.days ?? 0,
      hit: c?.hit ?? 0,
      totalSales: c?.totalSales ?? 0,
      avg_sales: c?.avg_sales ?? 0,
      consistency_pct: c?.consistency_pct ?? 0,
      achievement_pct: totalTarget ? Number((((c?.totalSales ?? 0) / totalTarget) * 100).toFixed(1)) : null,
    };
  });
  return { from, to, days, rows: perStore };
}));

// Today's ranking (or any date).
dashboardApi.get('/ranking', wrap(async (req) => {
  const date = req.query.date || todayDate();
  return { date, rows: await dailyRanking(date) };
}));

// Hourly heatmap — sales per (store, slot) over the range, summed.
dashboardApi.get('/hourly', wrap(async (req) => {
  const { from, to, store } = range(req);
  const rows = await queries.hourlyRange(from, to);
  const filtered = store ? rows.filter((r) => r.store_key === store) : rows;

  const cell = new Map(); // "store|slot" -> {sales, bills, walkins, count}
  for (const r of filtered) {
    const k = `${r.store_key}|${r.slot}`;
    const m = cell.get(k) ?? { sales: 0, bills: 0, walkins: 0, count: 0 };
    m.sales += r.sales || 0; m.bills += r.bills || 0; m.walkins += r.walkins || 0; m.count += 1;
    cell.set(k, m);
  }
  const slots = HOURLY_SLOTS.map((s) => `${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`);
  const stores = STORES.filter((s) => !store || s.key === store).map((s) => s.name);
  const matrix = STORES
    .filter((s) => !store || s.key === store)
    .map((s) => slots.map((slot) => {
      const m = cell.get(`${s.key}|${slot}`) ?? { sales: 0, bills: 0, walkins: 0, count: 0 };
      return { store: s.name, store_key: s.key, slot, ...m };
    }));

  return { from, to, store, slots, stores, matrix, rows: filtered };
}));

// Big bills list.
dashboardApi.get('/big-bills', wrap(async (req) => {
  const { from, to, store } = range(req);
  const rows = await queries.bigBillsRange(from, to);
  const withStore = rows.map((r) => ({ ...r, store: storeByKey(r.store_key)?.name || r.store_key }));
  return { from, to, rows: store ? withStore.filter((r) => r.store_key === store) : withStore };
}));

// Missing reports for a given date.
dashboardApi.get('/missing', wrap(async (req) => {
  const date = req.query.date || todayDate();
  const sections = {};
  for (const kind of ['opening', 'grooming', 'dsr']) {
    sections[kind] = (await missingReports(date, kind)).map((s) => ({ key: s.key, name: s.name }));
  }
  sections.hourly = {};
  for (const s of HOURLY_SLOTS) {
    const slot = `${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`;
    sections.hourly[slot] = (await missingReports(date, `hourly:${slot}`)).map((x) => ({ key: x.key, name: x.name }));
  }
  return { date, sections };
}));

// Raw messages.
dashboardApi.get('/messages', wrap(async (req) => {
  const { from, to } = range(req);
  const intent = req.query.intent || null;
  const limit = Math.min(500, Number(req.query.limit) || 200);
  const rows = await queries.messageLogRange(from, to, { intent, limit });
  return { from, to, intent, rows };
}));

function daysBetween(from, to) {
  const a = new Date(from + 'T00:00:00Z');
  const b = new Date(to   + 'T00:00:00Z');
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

// --- analytics ---

// Bundled analytics for one range — top/worst days, momentum (7-day MA),
// week-over-week per store, big-bill distribution, peak hour per store,
// streaks of consecutive days above target.
dashboardApi.get('/analytics', wrap(async (req) => {
  const { from, to, store } = range(req);

  // Comparison window = same length immediately before `from`.
  const days = daysBetween(from, to);
  const prevTo = addDaysStr(from, -1);
  const prevFrom = addDaysStr(prevTo, -(days - 1));

  const [dsrAll, hourly, bigBills, dsrPrev] = await Promise.all([
    queries.dsrRange(from, to),
    queries.hourlyRange(from, to),
    queries.bigBillsRange(from, to),
    queries.dsrRange(prevFrom, prevTo),
  ]);
  const dsr = store ? dsrAll.filter((r) => r.store_key === store) : dsrAll;
  const hourlyF = store ? hourly.filter((r) => r.store_key === store) : hourly;
  const billsF = store ? bigBills.filter((r) => r.store_key === store) : bigBills;
  const dsrPrevF = store ? dsrPrev.filter((r) => r.store_key === store) : dsrPrev;

  const storeName = (k) => storeByKey(k)?.name || k;

  // Top / worst days at (store, date) grain — DSR is authoritative; hourly gaps if none.
  const perStoreDate = new Map(); // "store|date" -> sales
  for (const r of dsr) perStoreDate.set(`${r.store_key}|${r.date}`, r.total_sales || 0);
  for (const r of hourlyF) {
    const k = `${r.store_key}|${r.date}`;
    if (!perStoreDate.has(k)) perStoreDate.set(k, 0);
    perStoreDate.set(k, perStoreDate.get(k) + (r.sales || 0));
  }
  // Prefer DSR value where both exist (overwrite the hourly-summed one).
  for (const r of dsr) perStoreDate.set(`${r.store_key}|${r.date}`, r.total_sales || 0);

  const flatSales = Array.from(perStoreDate.entries())
    .map(([k, sales]) => { const [store_key, date] = k.split('|'); return { date, store_key, store: storeName(store_key), sales }; });
  const topDays = flatSales.filter((r) => r.sales > 0).sort((a, b) => b.sales - a.sales).slice(0, 10);
  const worstDays = flatSales.filter((r) => r.sales > 0).sort((a, b) => a.sales - b.sales).slice(0, 10);

  // Momentum — daily totals (all filtered stores) + 7-day trailing MA.
  const perDay = new Map();
  for (const [k, sales] of perStoreDate) {
    const [, date] = k.split('|');
    perDay.set(date, (perDay.get(date) || 0) + sales);
  }
  const momentum = Array.from(perDay.entries())
    .map(([date, sales]) => ({ date, sales }))
    .sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 0; i < momentum.length; i++) {
    const w = momentum.slice(Math.max(0, i - 6), i + 1);
    momentum[i].ma7 = Math.round(w.reduce((a, r) => a + r.sales, 0) / w.length);
  }

  // Week-over-week per store.
  const currentByStore = new Map(); const prevByStore = new Map();
  for (const r of dsr)      currentByStore.set(r.store_key, (currentByStore.get(r.store_key) || 0) + (r.total_sales || 0));
  for (const r of dsrPrevF) prevByStore.set(r.store_key,     (prevByStore.get(r.store_key)     || 0) + (r.total_sales || 0));
  const weekOverWeek = STORES
    .filter((s) => !store || s.key === store)
    .map((s) => {
      const cur = currentByStore.get(s.key) || 0;
      const prev = prevByStore.get(s.key) || 0;
      const deltaPct = prev ? Number((((cur - prev) / prev) * 100).toFixed(1)) : (cur ? 100 : 0);
      return { store: s.name, store_key: s.key, current: cur, previous: prev, deltaPct };
    })
    .sort((a, b) => b.current - a.current);

  // Big bill amount distribution — bucket by 10k up to 100k, then 100k+.
  const buckets = [
    { label: '<25k',    min: 0,      max: 25_000  },
    { label: '25–50k',  min: 25_000, max: 50_000  },
    { label: '50–75k',  min: 50_000, max: 75_000  },
    { label: '75–100k', min: 75_000, max: 100_000 },
    { label: '100k+',   min: 100_000, max: Infinity },
  ].map((b) => ({ ...b, count: 0, total: 0 }));
  for (const b of billsF) {
    const amt = b.amount || 0;
    const bucket = buckets.find((x) => amt >= x.min && amt < x.max) || buckets[buckets.length - 1];
    bucket.count += 1; bucket.total += amt;
  }
  const billDistribution = buckets.map(({ label, count, total }) => ({ bucket: label, count, total }));

  // Peak hour per store — average sales per slot over the range.
  const perStoreSlot = new Map();
  for (const r of hourlyF) {
    const k = `${r.store_key}|${r.slot}`;
    const m = perStoreSlot.get(k) || { sum: 0, n: 0 };
    m.sum += r.sales || 0; m.n += 1;
    perStoreSlot.set(k, m);
  }
  const bestByStore = new Map();
  for (const [k, m] of perStoreSlot) {
    const [sKey, slot] = k.split('|');
    const avg = m.n ? Math.round(m.sum / m.n) : 0;
    const best = bestByStore.get(sKey);
    if (!best || best.avgSales < avg) bestByStore.set(sKey, { slot, avgSales: avg });
  }
  const peakHours = STORES
    .filter((s) => !store || s.key === store)
    .map((s) => ({ store: s.name, store_key: s.key, ...(bestByStore.get(s.key) || { slot: '—', avgSales: 0 }) }));

  // Consecutive-days-above-target streak per store (within the range).
  const streaks = STORES
    .filter((s) => !store || s.key === store)
    .map((s) => {
      const rows = dsr.filter((r) => r.store_key === s.key).sort((a, b) => a.date.localeCompare(b.date));
      let best = 0, cur = 0;
      for (const r of rows) {
        if ((r.total_sales || 0) >= s.dailyTarget) { cur += 1; if (cur > best) best = cur; }
        else cur = 0;
      }
      return { store: s.name, store_key: s.key, best_streak: best, current_streak: cur };
    })
    .sort((a, b) => b.best_streak - a.best_streak);

  return { from, to, store, days, prevFrom, prevTo, topDays, worstDays, momentum, weekOverWeek, billDistribution, peakHours, streaks };
}));

// --- WhatsApp status + QR ---

dashboardApi.get('/whatsapp', wrap(async () => {
  const status = getConnectionStatus();
  const qr = getLatestQr();
  let qrDataUrl = null;
  if (qr && status !== 'connected') {
    try { qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, scale: 8 }); } catch {}
  }
  let groups = [];
  const sock = getSock();
  if (status === 'connected' && sock) {
    try {
      const raw = await sock.groupFetchAllParticipating();
      groups = Object.values(raw).map((g) => ({
        jid: g.id,
        name: g.subject,
        participants: (g.participants || []).length,
        whitelisted: isAllowedGroup(g.id),
      })).sort((a, b) => Number(b.whitelisted) - Number(a.whitelisted) || a.name.localeCompare(b.name));
    } catch (e) { groups = [{ error: e.message }]; }
  }
  return { status, qr: qrDataUrl, groups, managerJid: MANAGER_GROUP_JID || null };
}));

// Unlink the WhatsApp session cleanly. Calls sock.logout() so WhatsApp
// removes the device on the user's phone, wipes local auth, then exits so
// Railway restarts fresh. Next boot shows a QR ready for a new scan.
dashboardApi.post('/whatsapp/unlink', wrap(async () => {
  const sock = getSock();
  if (sock) {
    try { await sock.logout(); }
    catch (e) { console.warn('[unlink] sock.logout failed (continuing to wipe):', e.message); }
  }
  const authDir = path.resolve('auth');
  try {
    if (fs.existsSync(authDir)) {
      for (const f of fs.readdirSync(authDir)) {
        fs.rmSync(path.join(authDir, f), { recursive: true, force: true });
      }
    }
  } catch (e) { console.error('[unlink] wipe failed:', e.message); }
  // Give the response time to reach the browser before we kill the process.
  setTimeout(() => process.exit(0), 300);
  return { ok: true, message: 'unlinked — bot restarting, fresh QR in ~10s' };
}));

// --- Broadcast (manual message to a WhatsApp group) ---

dashboardApi.post('/broadcast', wrap(async (req) => {
  const jid = String(req.body?.jid || '').trim();
  const text = String(req.body?.text || '').trim();
  if (!jid) throw new Error('jid required');
  if (!text) throw new Error('text required');
  if (!isAllowedGroup(jid)) throw new Error('target jid is not whitelisted — set MAIN_GROUP_JID (or MANAGER_GROUP_JID) in .env first');
  const sock = getSock();
  if (!sock) throw new Error('bot not connected');
  await sock.sendMessage(jid, { text });
  // Log the outbound message so it shows up in the message log view.
  try {
    await queries.logMessage({
      jid, sender: 'dashboard', is_group: 1,
      text, intent: 'broadcast',
      parsed_json: { source: 'dashboard-api/broadcast' },
      received_at: nowIso(),
    });
  } catch {}
  return { ok: true, jid, sentAt: nowIso() };
}));

function addDaysStr(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

// --- store management ---

dashboardApi.get('/stores/all', wrap(async () => {
  const rows = await listAllStores();
  return { stores: rows };
}));

dashboardApi.post('/stores', wrap(async (req) => {
  const { key, name, phone, daily_target, hourly_target } = req.body || {};
  const row = await addStore({ key, name, phone, daily_target, hourly_target });
  return { ok: true, store: row };
}));

dashboardApi.delete('/stores/:key', wrap(async (req) => {
  await deactivateStore(req.params.key);
  return { ok: true };
}));

dashboardApi.post('/stores/:key/reactivate', wrap(async (req) => {
  await reactivateStore(req.params.key);
  return { ok: true };
}));
