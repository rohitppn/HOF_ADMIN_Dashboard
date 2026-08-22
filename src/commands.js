import fs from 'node:fs';
import path from 'node:path';
import { isOwner, STORES, storeByKey, HOURLY_SLOTS } from './config.js';
import { queries } from './supabase.js';
import { dailyRanking, missingReports } from './calc.js';
import { templates } from './templates.js';
import { todayDate } from './util.js';

const exportDir = path.resolve('exports');
if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });

function toCsv(rows, headers) {
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = headers.join(',');
  const body = rows.map((r) => headers.map((h) => esc(r[h])).join(',')).join('\n');
  return head + '\n' + body + '\n';
}

function writeCsv(filename, csv) {
  const full = path.join(exportDir, filename);
  fs.writeFileSync(full, csv);
  return full;
}

// Returns one of:
//   { reply: string }                    — text reply to the same chat
//   { reply, dm: { filePath, caption } } — text reply + DM to owner with file attachment
//   null if not a command
export async function handleOwnerCommand({ text, senderPhone }) {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;

  if (!isOwner(senderPhone)) {
    return { reply: templates.ownerOnly() };
  }

  const [cmd, ...args] = trimmed.split(/\s+/);

  switch (cmd) {
    case '/help':
      return { reply: templates.help() };

    case '/ranking': {
      const date = args[0] || todayDate();
      const rows = await dailyRanking(date);
      return { reply: templates.dailyRanking({ date, rows }) };
    }

    case '/missing': {
      const date = todayDate();
      const sections = [];
      const open = await missingReports(date, 'opening');
      if (open.length) sections.push(templates.missingReport({ kind: 'store opening', stores: open }));
      const groom = await missingReports(date, 'grooming');
      if (groom.length) sections.push(templates.missingReport({ kind: 'grooming', stores: groom }));
      for (const s of HOURLY_SLOTS) {
        const slot = `${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`;
        const m = await missingReports(date, `hourly:${slot}`);
        if (m.length) sections.push(templates.missingReport({ kind: `hourly ${slot}`, stores: m }));
      }
      const dsr = await missingReports(date, 'dsr');
      if (dsr.length) sections.push(templates.missingReport({ kind: 'DSR', stores: dsr }));
      return { reply: sections.length ? sections.join('\n\n') : `All reports received for ${date}.` };
    }

    case '/report': {
      const sub = args[0];
      if (sub === 'today') {
        const date = todayDate();
        const rows = await dailyRanking(date);
        const csv = toCsv(rows, ['rank', 'store', 'total_sales', 'target', 'achievement_pct', 'total_bills', 'walkins', 'conversion', 'source']);
        const filename = `report-today-${date}.csv`;
        const filePath = writeCsv(filename, csv);
        return { reply: templates.reportSent({ filename }), dm: { filePath, caption: `Today's sales report — ${date}` } };
      }
      if (sub === 'store') {
        const [, key, from, to] = args;
        const store = storeByKey(key);
        if (!store || !from || !to) {
          return { reply: `Usage: /report store <key> <from-date> <to-date>. Stores: ${STORES.map((s) => s.key).join(', ')}` };
        }
        const rows = (await queries.dsrRange(from, to)).filter((r) => r.store_key === store.key);
        if (!rows.length) return { reply: `No DSR records for ${store.name} in ${from}..${to}.` };
        const csv = toCsv(rows, ['date', 'store_key', 'total_sales', 'total_bills', 'walkins', 'conversion', 'reported_at']);
        const filename = `report-${store.key}-${from}_to_${to}.csv`;
        const filePath = writeCsv(filename, csv);
        return { reply: templates.reportSent({ filename }), dm: { filePath, caption: `${store.name} sales report (${from} to ${to})` } };
      }
      return { reply: templates.unknownCommand() };
    }

    default:
      return { reply: templates.unknownCommand() };
  }
}
