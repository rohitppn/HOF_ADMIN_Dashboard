// Runtime config. Stores are loaded from Supabase (see sql/002_stores.sql) at
// boot and can be added / removed live from the dashboard. Group JIDs, owner
// numbers and secrets stay in .env — those don't change often enough to warrant
// a DB round-trip on every message.

import { supabase } from './supabase.js';

export const TIMEZONE = process.env.TZ || 'Asia/Kolkata';

// Owners: comma-separated in .env (e.g. OWNERS=919876543210,919812345678)
export const OWNERS = (process.env.OWNERS || '')
  .split(',')
  .map((s) => s.trim().replace(/\D/g, ''))
  .filter(Boolean);

// The single WhatsApp group where all store managers post updates.
export const MAIN_GROUP_JID = process.env.MAIN_GROUP_JID || '';

// Leadership group for rankings + alerts + owner Q&A. Defaults to main group.
export const MANAGER_GROUP_JID = process.env.MANAGER_GROUP_JID || MAIN_GROUP_JID;

// Late-opening threshold (24h clock).
export const OPENING_DEADLINE = { hour: 10, minute: 30 };

// Hourly check-in slots — bot @mentions all stores in the main group at these times.
export const HOURLY_SLOTS = [
  { hour: 13, minute: 0 },
  { hour: 15, minute: 0 },
  { hour: 17, minute: 0 },
  { hour: 19, minute: 0 },
  { hour: 21, minute: 0 },
];

// End-of-day job — when to ask for DSR and post daily ranking.
export const EOD_TIME = { hour: 22, minute: 0 };

// High-value bill threshold for "major sale" alerts.
export const BIG_BILL_THRESHOLD = 25000;

// ────────────────────────────────────────────────────────────────
// STORES — mutable, loaded from DB. Uses splice() so `STORES` keeps
// the same array reference and existing imports see updates live.
// ────────────────────────────────────────────────────────────────

export const STORES = [];
const phoneMap = new Map();

// Digits-only phone.
const digits = (s) => String(s || '').replace(/\D/g, '');

// Return the full international phone (adds "91" prefix if missing).
export const intlPhone = (phone) => {
  const p = digits(phone);
  return p.startsWith('91') ? p : '91' + p;
};

function rebuildPhoneMap() {
  phoneMap.clear();
  for (const s of STORES) {
    const p = digits(s.phone);
    phoneMap.set(p, s);
    if (!p.startsWith('91')) phoneMap.set('91' + p, s);
  }
}

// Seed data lives in src/seed-stores.js which is GITIGNORED — the file may not
// exist in a fresh clone, so we import lazily inside loadStores(). If missing
// or empty, first boot leaves the DB empty and the user adds stores from the
// dashboard's Manage tab.

function dbToStore(row) {
  return {
    key: row.key,
    name: row.name,
    phone: row.phone,
    dailyTarget: row.daily_target,
    hourlyTarget: row.hourly_target,
    active: row.active !== false,
  };
}

// Load active stores from Supabase into memory. Seeds the table on first boot
// if it's empty. Call at server startup AND after each add/remove mutation so
// the bot immediately routes to the new list.
export async function loadStores() {
  const { data, error } = await supabase.from('stores').select('*').eq('active', true).order('name');
  if (error) throw new Error(`[stores] load failed: ${error.message}`);

  let rows = data;
  if (!rows.length) {
    // Try loading the gitignored seed file. Absent on a fresh clone — that's OK.
    let seed = [];
    try { ({ SEED_STORES: seed } = await import('./seed-stores.js')); } catch { /* no seed */ }
    if (seed.length) {
      console.log(`[stores] table empty — seeding with ${seed.length} stores from seed-stores.js`);
      const { error: seedErr } = await supabase.from('stores').upsert(seed, { onConflict: 'key' });
      if (seedErr) throw new Error(`[stores] seed failed: ${seedErr.message}`);
      const reload = await supabase.from('stores').select('*').eq('active', true).order('name');
      if (reload.error) throw new Error(`[stores] reload failed: ${reload.error.message}`);
      rows = reload.data || [];
    } else {
      console.log('[stores] table empty and no seed file — add stores from the dashboard Manage tab');
    }
  }

  STORES.splice(0, STORES.length, ...rows.map(dbToStore));
  rebuildPhoneMap();
  console.log(`[stores] loaded ${STORES.length} active`);
  return STORES;
}

// Add a store. Validates required fields, upserts into DB, refreshes cache.
export async function addStore({ key, name, phone, daily_target, hourly_target }) {
  if (!key || !name || !phone) throw new Error('key, name, phone are required');
  const cleanKey = String(key).trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const cleanPhone = digits(phone);
  if (cleanPhone.length < 10) throw new Error('phone must be at least 10 digits');
  const row = {
    key: cleanKey,
    name: String(name).trim(),
    phone: cleanPhone,
    daily_target: Number(daily_target) || 100000,
    hourly_target: Number(hourly_target) || 12000,
    active: true,
  };
  const { error } = await supabase.from('stores').upsert(row, { onConflict: 'key' });
  if (error) throw new Error(error.message);
  await loadStores();
  return row;
}

// Soft-delete a store — bot immediately stops routing to it. Historical rows
// keep their store_key so past sales stay in the dashboard.
export async function deactivateStore(key) {
  if (!key) throw new Error('key required');
  const { error } = await supabase.from('stores').update({ active: false, updated_at: new Date().toISOString() }).eq('key', key);
  if (error) throw new Error(error.message);
  await loadStores();
}

// Reactivate a previously deleted store.
export async function reactivateStore(key) {
  if (!key) throw new Error('key required');
  const { error } = await supabase.from('stores').update({ active: true, updated_at: new Date().toISOString() }).eq('key', key);
  if (error) throw new Error(error.message);
  await loadStores();
}

// Return every store row (including inactive) — for the manage-stores view.
export async function listAllStores() {
  const { data, error } = await supabase.from('stores').select('*').order('active', { ascending: false }).order('name');
  if (error) throw new Error(error.message);
  return (data || []).map((r) => ({ ...dbToStore(r), created_at: r.created_at, updated_at: r.updated_at }));
}

// Lookups — always read from the mutable STORES / phoneMap so they see the
// latest state without callers having to re-import.
export const storeByPhone = (phone) => phoneMap.get(digits(phone)) || null;
export const storeByKey   = (key)   => STORES.find((s) => s.key === key) || null;
export const storeByJid   = ()      => null;  // compat stub — single-group model
export const isOwner      = (phone) => OWNERS.includes(digits(phone));

// Store name → store lookup, used when the sender's phone can't identify the
// store (WhatsApp LIDs, unmapped staff phones). Scores each store on how many
// of its name-keywords appear in the message; full matches get a big bonus
// so they beat partials, but partials still win over no-matches.
//
// Examples:
//   "ZORA MALL RAIPUR"                → ZORA MALL      (full match: zora + mall)
//   "WOW BILL DONE BY ZORA STORE"     → ZORA MALL      (partial: zora only)
//   "Oberoi store Menka ASM"          → OBEROI         (full: oberoi)
//   "Store: *VK Ambience mall*"       → AMBIENCE V.K.  (full: ambience + vk)
//   "Ambience GGN"                    → AMBIENCE       (full: ambience — VK partial loses)
//   "*MOM PUNE*"                      → Mom Pune       (full: mom + pune — Phoenix partial loses)
//   "PMC Bangalore"                   → null           (no store keyword matches)
export function findStoreByText(text) {
  if (!text) return null;
  const norm = String(text).toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ');
  let best = null, bestScore = 0;
  for (const store of STORES) {
    const keywords = store.name.toLowerCase()
      .replace(/\./g, '')          // "V.K." → "VK"
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((k) => k.length >= 2);
    if (!keywords.length) continue;
    const matched = keywords.filter((k) => norm.includes(k)).length;
    if (matched === 0) continue;
    // Full-match wins big; partial matches still count so single-name mentions
    // (like "Oberoi" or "Zora") route correctly when no fuller match exists.
    const score = matched + (matched === keywords.length ? 100 : 0);
    if (score > bestScore) { best = store; bestScore = score; }
  }
  return best;
}

// Group whitelist.
export const ALLOWED_JIDS = new Set(
  [MAIN_GROUP_JID, MANAGER_GROUP_JID].filter(Boolean)
);
export const isAllowedGroup = (jid) => ALLOWED_JIDS.has(jid);
