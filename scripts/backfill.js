// One-time SQLite → Supabase backfill.
// Idempotent for tables with a unique constraint (upsert on conflict);
// dedupes big_bills / message_log by (row-count === source) so a rerun is a no-op.
//
// Usage:
//   npm run backfill            # normal run — skips already-backfilled tables
//   npm run backfill -- --force # ignore the skip guard and re-push everything

import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { supabase, queries } from '../src/supabase.js';

const FORCE = process.argv.includes('--force');
const sqlitePath = path.resolve('data/hof.db');

if (!fs.existsSync(sqlitePath)) {
  console.error(`[backfill] no SQLite file at ${sqlitePath} — nothing to migrate.`);
  process.exit(1);
}

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[backfill] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env');
  process.exit(1);
}

const db = new Database(sqlitePath, { readonly: true });

async function targetCount(table) {
  const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
  if (error) throw new Error(`count(${table}): ${error.message}`);
  return count ?? 0;
}

async function batch(table, rows, onConflict) {
  if (!rows.length) return;
  // Supabase caps a single request payload — 500 rows/batch is safe.
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const q = onConflict
      ? supabase.from(table).upsert(slice, { onConflict })
      : supabase.from(table).insert(slice);
    const { error } = await q;
    if (error) throw new Error(`${table} batch ${i}: ${error.message}`);
    process.stdout.write(`  ${table}: ${Math.min(i + CHUNK, rows.length)}/${rows.length}\r`);
  }
  console.log(`  ${table}: ${rows.length}/${rows.length}   `);
}

async function migrateUpsert(table, onConflict) {
  const rows = db.prepare(`SELECT * FROM ${table}`).all();
  console.log(`[${table}] source rows: ${rows.length}`);
  const stripped = rows.map(({ id, ...r }) => r); // let Postgres assign fresh ids
  await batch(table, stripped, onConflict);
}

async function migrateInsertOnce(table) {
  const rows = db.prepare(`SELECT * FROM ${table}`).all();
  console.log(`[${table}] source rows: ${rows.length}`);
  if (!FORCE) {
    const existing = await targetCount(table);
    if (existing >= rows.length) {
      console.log(`  skip — target already has ${existing} rows (rerun with --force to re-insert)`);
      return;
    }
  }
  const stripped = rows.map(({ id, ...r }) => r);
  await batch(table, stripped, null);
}

async function migrateMessageLog() {
  const rows = db.prepare(`SELECT * FROM message_log`).all();
  console.log(`[message_log] source rows: ${rows.length}`);
  if (!FORCE) {
    const existing = await targetCount('message_log');
    if (existing >= rows.length) {
      console.log(`  skip — target already has ${existing} rows (rerun with --force to re-insert)`);
      return;
    }
  }
  const stripped = rows.map(({ id, parsed_json, ...r }) => ({
    ...r,
    parsed_json: parsed_json ? safeParse(parsed_json) : null,
  }));
  await batch('message_log', stripped, null);
}

function safeParse(s) { try { return JSON.parse(s); } catch { return { _raw: s }; } }

(async () => {
  console.log(`Backfilling ${sqlitePath} → ${process.env.SUPABASE_URL}${FORCE ? ' (FORCE)' : ''}`);
  try {
    await migrateUpsert('opening_balance', 'store_key,date');
    await migrateUpsert('store_open',      'store_key,date');
    await migrateUpsert('hourly_sales',    'store_key,date,slot');
    await migrateUpsert('grooming',        'store_key,date');
    await migrateUpsert('dsr',             'store_key,date');
    await migrateInsertOnce('big_bills');
    await migrateMessageLog();
    console.log('\n✅ Backfill complete.');
    // Silence the unused-var lint if `queries` becomes unused after edits.
    void queries;
  } catch (e) {
    console.error('\n❌ Backfill failed:', e.message);
    process.exit(1);
  }
})();
