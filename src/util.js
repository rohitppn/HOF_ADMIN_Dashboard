import { TIMEZONE } from './config.js';

const dtf = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
});

function parts(d = new Date()) {
  const obj = {};
  for (const p of dtf.formatToParts(d)) if (p.type !== 'literal') obj[p.type] = p.value;
  return obj;
}

export function todayDate(d = new Date()) {
  const p = parts(d);
  return `${p.year}-${p.month}-${p.day}`;
}

export function nowIso(d = new Date()) {
  const p = parts(d);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

export function nowHm(d = new Date()) {
  const p = parts(d);
  return { hour: Number(p.hour), minute: Number(p.minute) };
}

// Pick the slot label closest in time to "now" — used to bucket free-text hourly updates.
export function nearestSlotLabel(slots, d = new Date()) {
  const { hour, minute } = nowHm(d);
  const nowMins = hour * 60 + minute;
  let best = slots[0];
  let bestDiff = Infinity;
  for (const s of slots) {
    const m = s.hour * 60 + s.minute;
    const diff = Math.abs(m - nowMins);
    if (diff < bestDiff) { bestDiff = diff; best = s; }
  }
  return `${String(best.hour).padStart(2, '0')}:${String(best.minute).padStart(2, '0')}`;
}

export function formatINR(n) {
  if (n == null) return '—';
  return '₹' + Number(n).toLocaleString('en-IN');
}

export function pct(num, den) {
  if (!den) return null;
  return Number(((num / den) * 100).toFixed(1));
}
