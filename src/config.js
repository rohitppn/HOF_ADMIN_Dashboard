// Single source of truth for stores, owners, groups, and targets.
// Group JIDs and owner numbers come from .env so deployments can change them
// without code changes. Store list (keys, names, targets) lives here because
// it's business logic. To add a store: add a row in STORES below AND a matching
// STORE_<KEY>_JID line in .env.

export const TIMEZONE = process.env.TZ || 'Asia/Kolkata';

// Owners: comma-separated in .env (e.g. OWNERS=919876543210,919812345678)
export const OWNERS = (process.env.OWNERS || '')
  .split(',')
  .map((s) => s.trim().replace(/\D/g, ''))
  .filter(Boolean);

// Manager / leadership group JID — rankings and alerts go here.
export const MANAGER_GROUP_JID = process.env.MANAGER_GROUP_JID || '';

// Helper: pull a store's JID from env by its key.
const jidFor = (key) => process.env[`STORE_${key.toUpperCase()}_JID`] || '';

// Stores. Each store has:
//   key:           short slug used internally and in commands
//   name:          display name shown in messages
//   groupJid:      auto-loaded from .env (STORE_<KEY>_JID)
//   dailyTarget:   ₹ per day (will become dynamic — see targets tab in Sheets)
//   hourlyTarget:  ₹ per hour (used for the >50% rule on hourly check-ins)
export const STORES = [
  { key: 'cp',       name: 'Connaught Place', groupJid: jidFor('cp'),       dailyTarget: 150000, hourlyTarget: 18000 },
  { key: 'jkmall',   name: 'JK Mall',         groupJid: jidFor('jkmall'),   dailyTarget: 120000, hourlyTarget: 15000 },
  { key: 'dlf',      name: 'DLF Mall',        groupJid: jidFor('dlf'),      dailyTarget: 130000, hourlyTarget: 16000 },
  { key: 'gip',      name: 'GIP',             groupJid: jidFor('gip'),      dailyTarget: 110000, hourlyTarget: 14000 },
  { key: 'ambience', name: 'Ambience',        groupJid: jidFor('ambience'), dailyTarget: 140000, hourlyTarget: 17000 },
].filter((s) => s.groupJid); // drop stores whose JID isn't set yet — bot ignores them safely

// Late-opening threshold (24h clock).
export const OPENING_DEADLINE = { hour: 10, minute: 30 };

// Hourly check-in slots (24h clock). Bot prompts stores at these times.
export const HOURLY_SLOTS = [
  { hour: 14, minute: 0 },
  { hour: 15, minute: 0 },
  { hour: 17, minute: 0 },
  { hour: 19, minute: 0 },
];

// EOD job — when to ask for DSR and post daily ranking.
export const EOD_TIME = { hour: 22, minute: 0 };

// High-value bill threshold for "major sale" alerts.
export const BIG_BILL_THRESHOLD = 25000;

// All whitelisted group JIDs (manager + every store) — used for input-side guard.
export const ALLOWED_JIDS = new Set(
  [MANAGER_GROUP_JID, ...STORES.map((s) => s.groupJid)].filter(Boolean)
);

// Helpers
export const storeByJid = (jid) => STORES.find((s) => s.groupJid === jid);
export const storeByKey = (key) => STORES.find((s) => s.key === key);
export const isOwner = (phone) => OWNERS.includes(String(phone).replace(/\D/g, ''));
export const isAllowedGroup = (jid) => ALLOWED_JIDS.has(jid);
