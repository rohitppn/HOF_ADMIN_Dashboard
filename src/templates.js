// Pre-approved message library. Tone: professional, leadership voice, no emojis, no casual language.
// All bot output MUST go through one of these. Do not emit free-form text.

import { formatINR } from './util.js';
import { STORES } from './config.js';

const storeKeys = () => STORES.map((s) => s.key);
const storeNameOf = (key) => STORES.find((s) => s.key === key)?.name || key;

export const templates = {
  // ─── store group prompts ────────────────────────────────────────────
  promptOpeningBalance: () =>
    `Good morning. Please share the opening balance for today.`,

  promptStoreOpen: () =>
    `Reminder: please confirm store opening before 10:30 AM.`,

  promptHourly: (slotLabel) =>
    `Hourly check-in (${slotLabel}). Please share sales, bill count, and walk-ins so far today.`,

  promptGrooming: () =>
    `Please confirm grooming compliance for the team on shift today.`,

  promptDsr: () =>
    `End of day. Please share the Daily Sales Report: total sales, total bills, and walk-ins.`,

  ack: () => `Noted.`,

  // ─── manager / leadership group ─────────────────────────────────────
  hourlyAbove50: ({ store, slot, sales, pct }) =>
    `Performance update — ${store.name}\n` +
    `Slot ${slot}: ${formatINR(sales)} (${pct.toFixed(1)}% of hourly target).\n` +
    `Pace is above the 50% threshold. Sustaining this through the day will close the gap on target.`,

  bigBillAlert: ({ store, amount }) =>
    `Major sale recorded — ${store.name}: ${formatINR(amount)}. Acknowledging the team's effort.`,

  lateOpening: ({ store, opened_at }) =>
    `Compliance flag — ${store.name} opened at ${opened_at.split('T')[1]}, past the 10:30 AM threshold. Please follow up with the store manager.`,

  missingReport: ({ kind, stores }) => {
    const list = stores.map((s) => `• ${s.name}`).join('\n');
    return `Pending ${kind} update from:\n${list}`;
  },

  dailyRanking: ({ date, rows }) => {
    const ranked = rows.filter((r) => r.rank).map((r) =>
      `${r.rank}. ${r.store} — ${formatINR(r.total_sales)}` +
      (r.achievement_pct != null ? ` (${r.achievement_pct}% of target)` : '')
    );
    const missing = rows.filter((r) => !r.rank).map((r) => `• ${r.store} — awaiting input`);
    let out = `Daily Ranking — ${date}\n\n${ranked.join('\n') || 'No data submitted.'}`;
    if (missing.length) out += `\n\nAwaiting input from:\n${missing.join('\n')}`;
    return out;
  },

  // ─── owner-only command responses ──────────────────────────────────
  ownerOnly: () =>
    `This command is restricted to authorised owners.`,

  reportSent: ({ filename }) =>
    `Report generated: ${filename}. Sent to your direct messages.`,

  unknownCommand: () =>
    `Command not recognised. Available: /report today, /report store <key> <from> <to>, /ranking, /missing, /help.`,

  help: () =>
    `Available commands (owners only):\n` +
    `/report today — today's sales CSV\n` +
    `/report store <key> <from-date> <to-date> — store-level CSV\n` +
    `/ranking — current ranking\n` +
    `/missing — stores yet to report today\n` +
    `/help — this list\n\n` +
    `You can also ask in plain language, e.g. "what is CP doing today?", "send last week's CP sales", "any big bills today?".`,

  // ─── Q&A responses (owner natural-language queries) ─────────────────
  qaUnknown: () =>
    `Could not identify the request. Try a clearer phrasing or use /help.`,

  qaUnknownStore: () =>
    `Store not recognised. Available stores: ${storeKeys().join(', ')}. Use /help for command syntax.`,

  qaNeedRange: ({ stores }) =>
    `Please specify a date range and a store key (one of: ${stores.join(', ')}).`,

  qaNoData: ({ scope }) =>
    `No data on record for ${scope}.`,

  storeSnapshot: ({ store, date, totals, dsr }) => {
    const target = store.dailyTarget;
    const sales = dsr?.total_sales ?? totals?.sales ?? null;
    const bills = dsr?.total_bills ?? totals?.bills ?? null;
    const walkins = dsr?.walkins ?? totals?.walkins ?? null;
    const ach = sales != null ? ((sales / target) * 100).toFixed(1) + '%' : '—';
    const source = dsr ? 'DSR' : (totals ? 'hourly' : 'no data');
    return [
      `${store.name} — ${date}`,
      `Sales: ${sales != null ? formatINR(sales) : '—'} (${ach} of target ${formatINR(target)})`,
      `Bills: ${bills ?? '—'}    Walk-ins: ${walkins ?? '—'}`,
      `Source: ${source}`,
    ].join('\n');
  },

  storeRangeSummary: ({ store, from, to, rows }) => {
    const total = rows.reduce((a, r) => a + (r.total_sales || 0), 0);
    const avg = rows.length ? Math.round(total / rows.length) : 0;
    const hit = rows.filter((r) => r.total_sales >= store.dailyTarget).length;
    const lines = rows.map((r) => `${r.date}: ${formatINR(r.total_sales)}`);
    return [
      `${store.name} — ${from} to ${to}`,
      `Days on record: ${rows.length}    Days hit target: ${hit}`,
      `Total: ${formatINR(total)}    Daily avg: ${formatINR(avg)}`,
      ``,
      lines.join('\n'),
    ].join('\n');
  },

  bigBillList: ({ date, rows }) => {
    if (!rows.length) return `No high-value bills recorded on ${date}.`;
    const lines = rows.map((r) => `• ${r.store} — ${formatINR(r.amount)}`);
    return `High-value bills — ${date}\n${lines.join('\n')}`;
  },

  consistencySummary: ({ from, to, rows }) => {
    if (!rows.length) return `No DSR data between ${from} and ${to}.`;
    const lines = rows.map((r, i) =>
      `${i + 1}. ${r.store} — ${r.consistency_pct}% (${r.hit}/${r.days} days), avg ${formatINR(r.avg_sales)}`
    );
    return `Consistency — ${from} to ${to}\n${lines.join('\n')}`;
  },

  hourlyBreakdown: ({ date, rows }) => {
    const byStore = new Map();
    for (const r of rows) {
      const arr = byStore.get(r.store_key) || [];
      arr.push(r);
      byStore.set(r.store_key, arr);
    }
    const blocks = [];
    for (const [storeKey, list] of byStore) {
      list.sort((a, b) => a.slot.localeCompare(b.slot));
      const storeName = storeNameOf(storeKey);
      const lines = list.map((r) => `  ${r.slot} — ${formatINR(r.sales)}${r.bills ? ` (${r.bills} bills)` : ''}`);
      blocks.push(`${storeName}\n${lines.join('\n')}`);
    }
    return `Hourly breakdown — ${date}\n\n${blocks.join('\n\n')}`;
  },
};
