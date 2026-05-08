import { queries } from './db.js';
import { STORES, storeByKey } from './config.js';
import { pct } from './util.js';

// Daily totals per store from hourly_sales (running total during day, before DSR lands).
export function dailyTotalsFromHourly(date) {
  const rows = queries.hourlyForDate(date);
  const map = new Map();
  for (const r of rows) {
    const m = map.get(r.store_key) ?? { sales: 0, bills: 0, walkins: 0 };
    m.sales += r.sales || 0;
    m.bills += r.bills || 0;
    m.walkins += r.walkins || 0;
    map.set(r.store_key, m);
  }
  return map;
}

// Final daily ranking — prefers DSR; falls back to hourly aggregate if DSR not posted.
export function dailyRanking(date) {
  const dsrRows = queries.dsrForDate(date);
  const dsrMap = new Map(dsrRows.map((r) => [r.store_key, r]));
  const hourly = dailyTotalsFromHourly(date);

  const rows = STORES.map((s) => {
    const d = dsrMap.get(s.key);
    const h = hourly.get(s.key);
    const total_sales = d?.total_sales ?? h?.sales ?? null;
    const total_bills = d?.total_bills ?? h?.bills ?? null;
    const walkins = d?.walkins ?? h?.walkins ?? null;
    const conversion = d?.conversion ?? pct(total_bills, walkins);
    return {
      store: s.name,
      store_key: s.key,
      target: s.dailyTarget,
      total_sales,
      total_bills,
      walkins,
      conversion,
      achievement_pct: total_sales != null ? pct(total_sales, s.dailyTarget) : null,
      source: d ? 'dsr' : (h ? 'hourly' : 'missing'),
    };
  });

  rows.sort((a, b) => {
    if (a.total_sales == null) return 1;
    if (b.total_sales == null) return -1;
    return b.total_sales - a.total_sales;
  });

  return rows.map((r, i) => ({ rank: r.total_sales != null ? i + 1 : null, ...r }));
}

// Consistency score across a date range — % of days each store hit ≥ daily target.
export function consistencyScore(fromDate, toDate) {
  const rows = queries.dsrRange(fromDate, toDate);
  const map = new Map();
  for (const r of rows) {
    const s = storeByKey(r.store_key);
    if (!s) continue;
    const m = map.get(r.store_key) ?? { store: s.name, target: s.dailyTarget, days: 0, hit: 0, totalSales: 0 };
    m.days += 1;
    m.totalSales += r.total_sales;
    if (r.total_sales >= s.dailyTarget) m.hit += 1;
    map.set(r.store_key, m);
  }
  return Array.from(map.values()).map((m) => ({
    ...m,
    consistency_pct: m.days ? Number(((m.hit / m.days) * 100).toFixed(1)) : 0,
    avg_sales: m.days ? Math.round(m.totalSales / m.days) : 0,
  })).sort((a, b) => b.consistency_pct - a.consistency_pct);
}

// Which stores haven't reported a given thing today.
export function missingReports(date, kind) {
  let presentKeys;
  if (kind === 'opening') {
    presentKeys = new Set(queries.storeOpenForDate(date).map((r) => r.store_key));
  } else if (kind === 'grooming') {
    presentKeys = new Set(queries.groomingForDate(date).map((r) => r.store_key));
  } else if (kind === 'dsr') {
    presentKeys = new Set(queries.dsrForDate(date).map((r) => r.store_key));
  } else if (kind?.startsWith('hourly:')) {
    const slot = kind.split(':')[1];
    const rows = queries.hourlyForDate(date).filter((r) => r.slot === slot);
    presentKeys = new Set(rows.map((r) => r.store_key));
  } else {
    presentKeys = new Set();
  }
  return STORES.filter((s) => !presentKeys.has(s.key));
}
