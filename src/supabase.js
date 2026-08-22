// Supabase-backed drop-in replacement for db.js.
// Every method returns a Promise — callers must `await`.
// Uses the service_role key so RLS is bypassed on the server.

import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  const missing = [!url && 'SUPABASE_URL', !key && 'SUPABASE_SERVICE_ROLE_KEY'].filter(Boolean).join(' and ');
  console.error('');
  console.error('╔══════════════════════════════════════════════════════════════════╗');
  console.error('║  FATAL: missing required env vars — bot cannot start             ║');
  console.error('╠══════════════════════════════════════════════════════════════════╣');
  console.error(`║  Missing: ${missing.padEnd(56)}║`);
  console.error('║                                                                  ║');
  console.error('║  Fix — Railway: Project → Variables tab → add:                   ║');
  console.error('║    SUPABASE_URL=https://<project>.supabase.co                    ║');
  console.error('║    SUPABASE_SERVICE_ROLE_KEY=<from Supabase Settings → API>      ║');
  console.error('║                                                                  ║');
  console.error('║  Fix — local: paste same values into .env, then restart.         ║');
  console.error('╚══════════════════════════════════════════════════════════════════╝');
  console.error('');
  process.exit(1);
}

export const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Small wrapper — logs and rethrows so failures surface loudly instead of
// silently dropping a sales row.
async function run(label, promise) {
  const { data, error } = await promise;
  if (error) {
    console.error(`[supabase] ${label} failed:`, error.message);
    throw error;
  }
  return data;
}

const upsert = (table, row, onConflict) =>
  run(`upsert ${table}`, supabase.from(table).upsert(row, { onConflict }).select());

const insert = (table, row) =>
  run(`insert ${table}`, supabase.from(table).insert(row).select());

const selectByDate = (table) =>
  (date) => run(`select ${table}`, supabase.from(table).select('*').eq('date', date));

export const queries = {
  saveOpeningBalance: (row) => upsert('opening_balance', row, 'store_key,date'),
  saveStoreOpen:      (row) => upsert('store_open',      row, 'store_key,date'),
  saveHourly:         (row) => upsert('hourly_sales',    row, 'store_key,date,slot'),
  saveBigBill:        (row) => insert('big_bills',       row),
  saveGrooming:       (row) => upsert('grooming',        row, 'store_key,date'),
  saveDsr:            (row) => upsert('dsr',             row, 'store_key,date'),

  logMessage: (row) => insert('message_log', {
    ...row,
    // db.js stored parsed_json as a stringified JSON blob; supabase column is jsonb,
    // so parse it back if the caller pre-stringified.
    parsed_json: typeof row.parsed_json === 'string'
      ? safeParse(row.parsed_json)
      : row.parsed_json ?? null,
  }),

  hourlyForDate: (date) =>
    run('select hourly_sales', supabase.from('hourly_sales').select('*').eq('date', date).order('store_key').order('slot')),

  hourlyForStoreSlot: async (storeKey, date, slot) => {
    const rows = await run(
      'select hourly_sales one',
      supabase.from('hourly_sales').select('*').eq('store_key', storeKey).eq('date', date).eq('slot', slot).limit(1)
    );
    return rows?.[0] ?? null;
  },

  dsrForDate: (date) =>
    run('select dsr', supabase.from('dsr').select('*').eq('date', date).order('total_sales', { ascending: false })),

  dsrRange: (from, to) =>
    run('select dsr range', supabase.from('dsr').select('*').gte('date', from).lte('date', to).order('date').order('store_key')),

  storeOpenForDate: selectByDate('store_open'),
  groomingForDate:  selectByDate('grooming'),

  bigBillsForDate: (date) =>
    run('select big_bills', supabase.from('big_bills').select('*').eq('date', date).order('amount', { ascending: false })),

  // Dashboard-only helpers — not called by the bot.
  hourlyRange: (from, to) =>
    run('select hourly_sales range', supabase.from('hourly_sales').select('*').gte('date', from).lte('date', to).order('date').order('store_key').order('slot')),

  storeOpenRange: (from, to) =>
    run('select store_open range', supabase.from('store_open').select('*').gte('date', from).lte('date', to)),

  bigBillsRange: (from, to) =>
    run('select big_bills range', supabase.from('big_bills').select('*').gte('date', from).lte('date', to).order('date').order('amount', { ascending: false })),

  groomingRange: (from, to) =>
    run('select grooming range', supabase.from('grooming').select('*').gte('date', from).lte('date', to)),

  messageLogRange: (from, to, opts = {}) => {
    let q = supabase.from('message_log').select('*').gte('received_at', from).lte('received_at', to + 'T23:59');
    if (opts.intent) q = q.eq('intent', opts.intent);
    if (opts.limit)  q = q.limit(opts.limit);
    return run('select message_log range', q.order('received_at', { ascending: false }));
  },
};

function safeParse(s) {
  try { return JSON.parse(s); } catch { return { _raw: s }; }
}
