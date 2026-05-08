import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve('data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, 'hof.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS opening_balance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_key TEXT NOT NULL,
  date TEXT NOT NULL,
  amount INTEGER NOT NULL,
  reported_at TEXT NOT NULL,
  raw_text TEXT,
  UNIQUE(store_key, date)
);

CREATE TABLE IF NOT EXISTS store_open (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_key TEXT NOT NULL,
  date TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  late INTEGER NOT NULL DEFAULT 0,
  raw_text TEXT,
  UNIQUE(store_key, date)
);

CREATE TABLE IF NOT EXISTS hourly_sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_key TEXT NOT NULL,
  date TEXT NOT NULL,
  slot TEXT NOT NULL,
  sales INTEGER NOT NULL,
  bills INTEGER,
  walkins INTEGER,
  reported_at TEXT NOT NULL,
  raw_text TEXT,
  UNIQUE(store_key, date, slot)
);

CREATE TABLE IF NOT EXISTS big_bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_key TEXT NOT NULL,
  date TEXT NOT NULL,
  amount INTEGER NOT NULL,
  reported_at TEXT NOT NULL,
  raw_text TEXT
);

CREATE TABLE IF NOT EXISTS grooming (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_key TEXT NOT NULL,
  date TEXT NOT NULL,
  compliant INTEGER NOT NULL,
  notes TEXT,
  reported_at TEXT NOT NULL,
  raw_text TEXT,
  UNIQUE(store_key, date)
);

CREATE TABLE IF NOT EXISTS dsr (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_key TEXT NOT NULL,
  date TEXT NOT NULL,
  total_sales INTEGER NOT NULL,
  total_bills INTEGER,
  walkins INTEGER,
  conversion REAL,
  reported_at TEXT NOT NULL,
  raw_text TEXT,
  UNIQUE(store_key, date)
);

CREATE TABLE IF NOT EXISTS message_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jid TEXT NOT NULL,
  sender TEXT,
  is_group INTEGER NOT NULL,
  text TEXT,
  intent TEXT,
  parsed_json TEXT,
  received_at TEXT NOT NULL
);
`);

const stmt = {
  upsertOpeningBalance: db.prepare(`
    INSERT INTO opening_balance (store_key, date, amount, reported_at, raw_text)
    VALUES (@store_key, @date, @amount, @reported_at, @raw_text)
    ON CONFLICT(store_key, date) DO UPDATE SET
      amount = excluded.amount,
      reported_at = excluded.reported_at,
      raw_text = excluded.raw_text
  `),
  upsertStoreOpen: db.prepare(`
    INSERT INTO store_open (store_key, date, opened_at, late, raw_text)
    VALUES (@store_key, @date, @opened_at, @late, @raw_text)
    ON CONFLICT(store_key, date) DO UPDATE SET
      opened_at = excluded.opened_at,
      late = excluded.late,
      raw_text = excluded.raw_text
  `),
  upsertHourly: db.prepare(`
    INSERT INTO hourly_sales (store_key, date, slot, sales, bills, walkins, reported_at, raw_text)
    VALUES (@store_key, @date, @slot, @sales, @bills, @walkins, @reported_at, @raw_text)
    ON CONFLICT(store_key, date, slot) DO UPDATE SET
      sales = excluded.sales,
      bills = excluded.bills,
      walkins = excluded.walkins,
      reported_at = excluded.reported_at,
      raw_text = excluded.raw_text
  `),
  insertBigBill: db.prepare(`
    INSERT INTO big_bills (store_key, date, amount, reported_at, raw_text)
    VALUES (@store_key, @date, @amount, @reported_at, @raw_text)
  `),
  upsertGrooming: db.prepare(`
    INSERT INTO grooming (store_key, date, compliant, notes, reported_at, raw_text)
    VALUES (@store_key, @date, @compliant, @notes, @reported_at, @raw_text)
    ON CONFLICT(store_key, date) DO UPDATE SET
      compliant = excluded.compliant,
      notes = excluded.notes,
      reported_at = excluded.reported_at,
      raw_text = excluded.raw_text
  `),
  upsertDsr: db.prepare(`
    INSERT INTO dsr (store_key, date, total_sales, total_bills, walkins, conversion, reported_at, raw_text)
    VALUES (@store_key, @date, @total_sales, @total_bills, @walkins, @conversion, @reported_at, @raw_text)
    ON CONFLICT(store_key, date) DO UPDATE SET
      total_sales = excluded.total_sales,
      total_bills = excluded.total_bills,
      walkins = excluded.walkins,
      conversion = excluded.conversion,
      reported_at = excluded.reported_at,
      raw_text = excluded.raw_text
  `),
  insertMessage: db.prepare(`
    INSERT INTO message_log (jid, sender, is_group, text, intent, parsed_json, received_at)
    VALUES (@jid, @sender, @is_group, @text, @intent, @parsed_json, @received_at)
  `),

  hourlyForDate: db.prepare(`SELECT * FROM hourly_sales WHERE date = ? ORDER BY store_key, slot`),
  hourlyForStoreSlot: db.prepare(`SELECT * FROM hourly_sales WHERE store_key = ? AND date = ? AND slot = ?`),
  dsrForDate: db.prepare(`SELECT * FROM dsr WHERE date = ? ORDER BY total_sales DESC`),
  dsrRange: db.prepare(`SELECT * FROM dsr WHERE date BETWEEN ? AND ? ORDER BY date, store_key`),
  storeOpenForDate: db.prepare(`SELECT * FROM store_open WHERE date = ?`),
  groomingForDate: db.prepare(`SELECT * FROM grooming WHERE date = ?`),
  bigBillsForDate: db.prepare(`SELECT * FROM big_bills WHERE date = ? ORDER BY amount DESC`),
};

export const queries = {
  saveOpeningBalance: (row) => stmt.upsertOpeningBalance.run(row),
  saveStoreOpen: (row) => stmt.upsertStoreOpen.run(row),
  saveHourly: (row) => stmt.upsertHourly.run(row),
  saveBigBill: (row) => stmt.insertBigBill.run(row),
  saveGrooming: (row) => stmt.upsertGrooming.run(row),
  saveDsr: (row) => stmt.upsertDsr.run(row),
  logMessage: (row) => stmt.insertMessage.run(row),

  hourlyForDate: (date) => stmt.hourlyForDate.all(date),
  hourlyForStoreSlot: (storeKey, date, slot) => stmt.hourlyForStoreSlot.get(storeKey, date, slot),
  dsrForDate: (date) => stmt.dsrForDate.all(date),
  dsrRange: (from, to) => stmt.dsrRange.all(from, to),
  storeOpenForDate: (date) => stmt.storeOpenForDate.all(date),
  groomingForDate: (date) => stmt.groomingForDate.all(date),
  bigBillsForDate: (date) => stmt.bigBillsForDate.all(date),
};
