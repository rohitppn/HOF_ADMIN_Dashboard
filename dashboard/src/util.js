// Date helpers — all in local (India) time via YYYY-MM-DD strings so they line up
// with the bot's todayDate() output which also uses Asia/Kolkata.

const IST = 'Asia/Kolkata';
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit' });

export function ymd(d = new Date()) { return fmt.format(d); }

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

// Presets: today, yesterday, last 7 days, this week (Mon), this month, this year, custom.
export function preset(name) {
  const today = ymd();
  if (name === 'today')     return { from: today, to: today };
  if (name === 'yesterday') { const d = addDays(today, -1); return { from: d, to: d }; }
  if (name === 'last7')     return { from: addDays(today, -6), to: today };
  if (name === 'week') {
    const [y, m, d] = today.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    const dow = (dt.getUTCDay() + 6) % 7; // Mon=0
    return { from: addDays(today, -dow), to: today };
  }
  if (name === 'month') {
    const [y, m] = today.split('-');
    return { from: `${y}-${m}-01`, to: today };
  }
  if (name === 'year') {
    const y = today.split('-')[0];
    return { from: `${y}-01-01`, to: today };
  }
  return { from: today, to: today };
}

export function inr(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return '₹' + Number(n).toLocaleString('en-IN');
}

export function num(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString('en-IN');
}

export function pctLabel(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return `${Number(n).toFixed(1)}%`;
}

// Store colors — stable per store_key so the same store is the same color everywhere.
const PALETTE = ['#7ab7ff', '#4ade80', '#fbbf24', '#a78bfa', '#f472b6', '#22d3ee', '#f87171', '#94a3b8'];
export function storeColor(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}
