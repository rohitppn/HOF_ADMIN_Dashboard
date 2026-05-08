import { parseMessage } from './claude.js';
import { queries } from './db.js';
import { appendRow } from './sheets.js';
import { storeByJid, OPENING_DEADLINE, HOURLY_SLOTS, BIG_BILL_THRESHOLD } from './config.js';
import { todayDate, nowIso, nowHm, nearestSlotLabel } from './util.js';

// Returns { intent, store, parsed, alert? } or null if message is not from a known store group.
export async function ingestStoreMessage({ jid, sender, text }) {
  const store = storeByJid(jid);
  if (!store) return null;

  const parsed = await parseMessage(text);
  const date = todayDate();
  const reported_at = nowIso();

  queries.logMessage({
    jid,
    sender: sender || null,
    is_group: 1,
    text,
    intent: parsed.intent,
    parsed_json: JSON.stringify(parsed),
    received_at: reported_at,
  });

  let alert = null;

  switch (parsed.intent) {
    case 'opening_balance': {
      if (parsed.amount == null) break;
      const row = { store_key: store.key, date, amount: parsed.amount, reported_at, raw_text: text };
      queries.saveOpeningBalance(row);
      await appendRow('opening_balance', { date, store: store.name, amount: parsed.amount, reported_at, raw_text: text });
      break;
    }

    case 'store_open': {
      const { hour, minute } = nowHm();
      const late = (hour > OPENING_DEADLINE.hour) || (hour === OPENING_DEADLINE.hour && minute > OPENING_DEADLINE.minute) ? 1 : 0;
      const row = { store_key: store.key, date, opened_at: reported_at, late, raw_text: text };
      queries.saveStoreOpen(row);
      await appendRow('store_open', { date, store: store.name, opened_at: reported_at, late, raw_text: text });
      if (late) alert = { type: 'late_open', store, opened_at: reported_at };
      break;
    }

    case 'hourly_sales': {
      if (parsed.amount == null) break;
      const slot = nearestSlotLabel(HOURLY_SLOTS);
      const row = {
        store_key: store.key,
        date,
        slot,
        sales: parsed.amount,
        bills: parsed.bills ?? null,
        walkins: parsed.walkins ?? null,
        reported_at,
        raw_text: text,
      };
      queries.saveHourly(row);
      await appendRow('hourly_sales', { date, store: store.name, slot, sales: parsed.amount, bills: parsed.bills, walkins: parsed.walkins, reported_at, raw_text: text });

      const pct = (parsed.amount / store.hourlyTarget) * 100;
      if (pct >= 50) alert = { type: 'hourly_above_50', store, slot, sales: parsed.amount, pct };
      break;
    }

    case 'big_bill': {
      if (parsed.amount == null) break;
      const row = { store_key: store.key, date, amount: parsed.amount, reported_at, raw_text: text };
      queries.saveBigBill(row);
      await appendRow('big_bills', { date, store: store.name, amount: parsed.amount, reported_at, raw_text: text });
      if (parsed.amount >= BIG_BILL_THRESHOLD) alert = { type: 'big_bill', store, amount: parsed.amount };
      break;
    }

    case 'grooming': {
      if (parsed.compliant == null) break;
      const row = {
        store_key: store.key,
        date,
        compliant: parsed.compliant ? 1 : 0,
        notes: parsed.notes ?? null,
        reported_at,
        raw_text: text,
      };
      queries.saveGrooming(row);
      await appendRow('grooming', { date, store: store.name, compliant: row.compliant, notes: row.notes, reported_at, raw_text: text });
      break;
    }

    case 'dsr': {
      if (parsed.amount == null) break;
      const conversion = parsed.bills && parsed.walkins ? Number(((parsed.bills / parsed.walkins) * 100).toFixed(2)) : null;
      const row = {
        store_key: store.key,
        date,
        total_sales: parsed.amount,
        total_bills: parsed.bills ?? null,
        walkins: parsed.walkins ?? null,
        conversion,
        reported_at,
        raw_text: text,
      };
      queries.saveDsr(row);
      await appendRow('dsr', { date, store: store.name, total_sales: parsed.amount, total_bills: parsed.bills, walkins: parsed.walkins, conversion, reported_at, raw_text: text });
      break;
    }

    default:
      break;
  }

  return { intent: parsed.intent, store, parsed, alert };
}
