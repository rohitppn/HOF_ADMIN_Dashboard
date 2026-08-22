import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import path from 'node:path';
import { STORES, storeByKey } from './config.js';
import { queries } from './supabase.js';
import { dailyRanking, consistencyScore, missingReports, dailyTotalsFromHourly } from './calc.js';
import { templates } from './templates.js';
import { todayDate, formatINR } from './util.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const STORE_LIST = () => STORES.map((s) => `${s.key}=${s.name}`).join(', ');

const QA_SYSTEM = () => `You classify natural-language questions from a retail business owner into a structured data query.

Known stores: ${STORE_LIST() || 'none'}

Allowed kinds:
- "today_overview"   — overall picture for today (all stores)
- "store_today"      — one store today (needs store_key)
- "store_range"      — one store across a date range (needs store_key, from, to as YYYY-MM-DD)
- "ranking"          — current daily ranking (optionally for a date)
- "big_bills"        — high-value bills (optionally for a date)
- "missing"          — pending/unsubmitted reports today
- "consistency"      — % of days each store hit target across a range
- "hourly"           — hourly breakdown (optionally per store, optionally date)
- "csv_dump"         — broad export — user wants a file with detailed data
- "unknown"          — anything else

Output strictly compact JSON, schema:
{
  "kind": "<one of above>",
  "store_key": "<key or null>",
  "date": "<YYYY-MM-DD or null>",
  "from": "<YYYY-MM-DD or null>",
  "to": "<YYYY-MM-DD or null>",
  "wants_csv": <true|false>,
  "confidence": <0..1>
}

Rules:
- If user mentions a store by name or alias, map it to the known store_key. If not recognised, set store_key null.
- Today's date is ${todayDate()}. Resolve "today", "yesterday", "last 7 days", "this week", "last week", "this month" relative to that.
- "send me", "give me file", "csv", "excel", "download", "export" → wants_csv true.
- Output JSON only. No prose, no code fences.`;

export async function classifyQuestion(text) {
  const resp = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    system: QA_SYSTEM(),
    messages: [{ role: 'user', content: text }],
  });
  const out = resp.content?.[0]?.text?.trim() ?? '';
  try {
    const cleaned = out.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return { kind: 'unknown', store_key: null, date: null, from: null, to: null, wants_csv: false, confidence: 0 };
  }
}

const exportDir = path.resolve('exports');
if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });

function csv(rows, headers) {
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return headers.join(',') + '\n' + rows.map((r) => headers.map((h) => esc(r[h])).join(',')).join('\n') + '\n';
}

function writeCsv(filename, content) {
  const full = path.join(exportDir, filename);
  fs.writeFileSync(full, content);
  return full;
}

// Returns { reply, dm? } based on classified query.
export async function answerQuestion(text) {
  const q = await classifyQuestion(text);

  switch (q.kind) {
    case 'today_overview':
    case 'ranking': {
      const date = q.date || todayDate();
      const rows = await dailyRanking(date);
      if (q.wants_csv) {
        const file = writeCsv(
          `ranking-${date}.csv`,
          csv(rows, ['rank', 'store', 'total_sales', 'target', 'achievement_pct', 'total_bills', 'walkins', 'conversion', 'source'])
        );
        return { reply: templates.reportSent({ filename: path.basename(file) }), dm: { filePath: file, caption: `Ranking — ${date}` } };
      }
      return { reply: templates.dailyRanking({ date, rows }) };
    }

    case 'store_today': {
      const store = storeByKey(q.store_key);
      if (!store) return { reply: templates.qaUnknownStore() };
      const date = q.date || todayDate();
      const totals = (await dailyTotalsFromHourly(date)).get(store.key);
      const dsr = (await queries.dsrForDate(date)).find((r) => r.store_key === store.key);
      return { reply: templates.storeSnapshot({ store, date, totals, dsr }) };
    }

    case 'store_range': {
      const store = storeByKey(q.store_key);
      if (!store || !q.from || !q.to) return { reply: templates.qaNeedRange({ stores: STORES.map((s) => s.key) }) };
      const rows = (await queries.dsrRange(q.from, q.to)).filter((r) => r.store_key === store.key);
      if (!rows.length) return { reply: templates.qaNoData({ scope: `${store.name} ${q.from} to ${q.to}` }) };
      if (q.wants_csv) {
        const file = writeCsv(
          `${store.key}-${q.from}_to_${q.to}.csv`,
          csv(rows, ['date', 'store_key', 'total_sales', 'total_bills', 'walkins', 'conversion', 'reported_at'])
        );
        return { reply: templates.reportSent({ filename: path.basename(file) }), dm: { filePath: file, caption: `${store.name} ${q.from} to ${q.to}` } };
      }
      return { reply: templates.storeRangeSummary({ store, from: q.from, to: q.to, rows }) };
    }

    case 'big_bills': {
      const date = q.date || todayDate();
      const rows = (await queries.bigBillsForDate(date)).map((r) => ({ ...r, store: STORES.find((s) => s.key === r.store_key)?.name || r.store_key }));
      return { reply: templates.bigBillList({ date, rows }) };
    }

    case 'missing': {
      const date = todayDate();
      const sections = [];
      for (const kind of ['opening', 'grooming', 'dsr']) {
        const m = await missingReports(date, kind);
        if (m.length) sections.push(templates.missingReport({ kind, stores: m }));
      }
      return { reply: sections.length ? sections.join('\n\n') : `All reports received for ${date}.` };
    }

    case 'consistency': {
      const from = q.from, to = q.to;
      if (!from || !to) return { reply: templates.qaNeedRange({ stores: STORES.map((s) => s.key) }) };
      const rows = await consistencyScore(from, to);
      if (q.wants_csv) {
        const file = writeCsv(`consistency-${from}_to_${to}.csv`, csv(rows, ['store', 'days', 'hit', 'consistency_pct', 'avg_sales', 'target']));
        return { reply: templates.reportSent({ filename: path.basename(file) }), dm: { filePath: file, caption: `Consistency ${from} to ${to}` } };
      }
      return { reply: templates.consistencySummary({ from, to, rows }) };
    }

    case 'hourly': {
      const date = q.date || todayDate();
      const all = await queries.hourlyForDate(date);
      const filtered = q.store_key ? all.filter((r) => r.store_key === q.store_key) : all;
      if (!filtered.length) return { reply: templates.qaNoData({ scope: `hourly ${date}` }) };
      if (q.wants_csv) {
        const file = writeCsv(`hourly-${date}${q.store_key ? '-' + q.store_key : ''}.csv`,
          csv(filtered, ['date', 'store_key', 'slot', 'sales', 'bills', 'walkins', 'reported_at']));
        return { reply: templates.reportSent({ filename: path.basename(file) }), dm: { filePath: file, caption: `Hourly ${date}` } };
      }
      return { reply: templates.hourlyBreakdown({ date, rows: filtered }) };
    }

    case 'csv_dump': {
      const date = q.date || todayDate();
      const rows = await dailyRanking(date);
      const file = writeCsv(`full-${date}.csv`,
        csv(rows, ['rank', 'store', 'total_sales', 'target', 'achievement_pct', 'total_bills', 'walkins', 'conversion', 'source']));
      return { reply: templates.reportSent({ filename: path.basename(file) }), dm: { filePath: file, caption: `Full data — ${date}` } };
    }

    default:
      return { reply: templates.qaUnknown() };
  }
}
