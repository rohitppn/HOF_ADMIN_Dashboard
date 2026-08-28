// Pure-regex message parser. Runs locally, no API calls, zero tokens spent.
// Same output shape as the old Claude-based parser so callers don't change.
//
// Handles the common House of Fett message formats:
//
//   Date:- 21/08/2026
//   Ambi VK
//   Today's Target: 110k
//   Achieved Till Now: 29993
//   Walk-ins : 6
//   Bills : 5
//
// Plus casual variants: "sales 25000, bills 4, walkins 8", "opening balance 5000",
// "store opened at 10:15", "grooming done", "big bill 45000", etc.

// --- text normalisation ---

// Convert keycap emoji digits (2️⃣) to plain digits, strip zero-width joiners,
// and remove WhatsApp @-mentions (long IDs) so they aren't picked up as amounts.
export function normalizeText(t) {
  return String(t || '')
    .replace(/([0-9])(?:️)?⃣/g, '$1')  // keycap digits
    .replace(/‍/g, '')                        // ZWJ that emoji sequences use
    .replace(/@\d{6,}/g, ' ');                       // @mentions e.g. @183065028645014
}

// --- number parsing ---

// Turn "1.2L", "12k", "1,20,000", "₹29993" into an integer rupee value.
export function parseAmount(str) {
  if (str == null) return null;
  const s = String(str).replace(/[₹\s]/g, '').replace(/rs\.?/i, '');
  const m = s.match(/(\d[\d,]*(?:\.\d+)?)\s*([kKlLmM])?/);
  if (!m) return null;
  const num = parseFloat(m[1].replace(/,/g, ''));
  if (!Number.isFinite(num)) return null;
  const suffix = (m[2] || '').toLowerCase();
  let value = num;
  if (suffix === 'k') value = num * 1_000;
  else if (suffix === 'l') value = num * 100_000;
  else if (suffix === 'm') value = num * 1_000_000;
  return Math.round(value);
}

// Turn "21/08/2026", "21-08-25", "21.8.26" into "YYYY-MM-DD" (DD/MM/YYYY input,
// Indian convention). Returns null if the value can't be parsed as a valid date.
export function parseDate(str) {
  if (str == null) return null;
  const m = String(str).match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (!m) return null;
  let [, dd, mm, yy] = m;
  let d = parseInt(dd, 10), mo = parseInt(mm, 10), y = parseInt(yy, 10);
  // If the "day" field is >12 and month field is ≤12, the format is DD/MM (good).
  // If "day" ≤12 and "month" >12, they typed MM/DD — swap.
  if (mo > 12 && d <= 12) { [d, mo] = [mo, d]; }
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  if (y < 100) y += 2000;
  // Guard against typos like "3026" — beyond a reasonable window, discard so
  // the caller falls back to today's date.
  const nowYear = new Date().getUTCFullYear();
  if (y > nowYear + 1 || y < nowYear - 5) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// --- field extraction ---

// Find "label: value" where label matches any of the given keyword regexes.
// Returns the raw value string, or null.
// Splits on newline / semicolon only — NOT comma, since Indian numbers use
// commas as thousand separators (46,441 must stay together).
function findFieldValue(text, keywordRegex) {
  for (const line of text.split(/\n|;/)) {
    const m = line.match(new RegExp(`(?:${keywordRegex})\\s*[:\\-–]*\\s*(.+)`, 'i'));
    if (m) return m[1].trim();
  }
  return null;
}

// Same but returns only the first integer inside the matched value.
function findFieldInt(text, keywordRegex) {
  const v = findFieldValue(text, keywordRegex);
  if (!v) return null;
  const m = v.match(/-?\d[\d,]*/);
  return m ? parseInt(m[0].replace(/,/g, ''), 10) : null;
}

// --- intent detection ---

const RX_OPENING   = /\bopen(?:ing)?\s*(?:balance|bal|cash)\b/i;
const RX_STORE_OPEN = /\b(store|shop|shutter)\s*(?:is\s*)?(open(?:ed)?|up)\b/i;
// No trailing \b so "grooming" also matches (\b after "groom" is inside the word).
const RX_GROOMING  = /\b(groom|uniform|attire|dress\s*code)/i;
const RX_BIG_BILL  = /\b(big|major|large|high[-\s]?value)\s*(?:bill|sale)|\bhvb\b/i;
const RX_CUMULATIVE = /\b(till\s*now|achieved|so\s*far|total|final|closing|end\s*of\s*day|dsr|eod)\b/i;

const KW_ACHIEVED  = 'achieved(?:\\s*till\\s*now)?|sales\\s*till\\s*now|total\\s*sales|day\\s*sales|net\\s*sales|final|closing';
const KW_OPENING   = 'opening\\s*balance|opening\\s*bal|opening\\s*cash|opening';
const KW_BIG_BILL  = 'big\\s*bill|major\\s*sale|high[-\\s]?value\\s*bill|hvb|big\\s*sale|bill\\s*of';
const KW_SALES     = 'sales|amount|revenue|amt';
const KW_BILLS     = 'bills?|bill\\s*count|no\\.?\\s*of\\s*bills';
const KW_WALKINS   = 'walk[-\\s]?ins?|walk[-\\s]?in\\s*count|foot\\s*fall|footfall';

// Main entry — same shape as the old Claude-backed parseMessage.
// Additional field: bigBillAmount — set when the message announces a big bill
// alongside another intent (e.g. "Wow Big Bill Value 25197 ... Achieved Till
// Now 46441") so caller can save BOTH a DSR row and a big_bills row.
export function parseMessage(text) {
  const raw = String(text || '').trim();
  if (!raw) return empty('other');

  const t = normalizeText(raw);
  const date = parseDate(t);
  const walkins = findFieldInt(t, KW_WALKINS);
  // Bills count only if the number is small — a "bill" in a message with
  // 45000 next to it is a rupee amount, not a bill count.
  const billsRaw = findFieldInt(t, KW_BILLS);
  const bills = billsRaw != null && billsRaw < 1000 ? billsRaw : null;

  // Field-priority extraction — prefer "Achieved Till Now" over "Total" over plain "Sales".
  const achievedRaw = findFieldValue(t, KW_ACHIEVED);
  const openingRaw  = findFieldValue(t, KW_OPENING);
  const salesRaw    = findFieldValue(t, KW_SALES);

  const hasBigBill = RX_BIG_BILL.test(t);
  const bigBillAmount = hasBigBill ? extractBigBillAmount(t) : null;

  let intent = 'other';
  let amount = null;

  if (RX_OPENING.test(t)) {
    intent = 'opening_balance';
    amount = parseAmount(openingRaw ?? firstNumberInMessage(t));
  } else if (RX_GROOMING.test(t)) {
    intent = 'grooming';
  } else if (RX_STORE_OPEN.test(t) && !achievedRaw && !salesRaw && !hasBigBill) {
    intent = 'store_open';
  } else if (achievedRaw != null) {
    intent = 'dsr';                                // "Achieved Till Now" = running total
    amount = parseAmount(achievedRaw);
    // bigBillAmount is already captured — caller inserts second row
  } else if (hasBigBill) {
    intent = 'big_bill';
    amount = bigBillAmount ?? parseAmount(firstNumberInMessage(t));
  } else if (salesRaw != null) {
    // A plain "sales" report — treat as DSR if the message hints at cumulative,
    // else hourly.
    intent = RX_CUMULATIVE.test(t) ? 'dsr' : 'hourly_sales';
    amount = parseAmount(salesRaw);
  } else {
    // Bare number in the message with no context — assume hourly update.
    const bareAmt = parseAmount(firstNumberInMessage(t));
    if (bareAmt != null && bareAmt >= 100) { // guard against phone digits etc.
      intent = 'hourly_sales';
      amount = bareAmt;
    }
  }

  // Grooming compliance signal.
  let compliant = null, notes = null;
  if (intent === 'grooming') {
    const positive = /(all\s*groom|properly\s*groom|well[-\s]?groom|100\s*%\s*groom|compliant|proper\s*uniform|grooming\s*done|✅|✓|👌)/i;
    const negative = /(not\s*groom|not\s*in\s*uniform|missing\s*uniform|non[-\s]?compliant|❌|✗|not\s*proper)/i;
    if (negative.test(t)) { compliant = false; notes = t.slice(0, 200); }
    else if (positive.test(t)) compliant = true;
    else compliant = /\b(done|ok|yes|complete|all\s*good)\b/i.test(t);
  }

  return {
    intent,
    date,
    amount,
    bills,
    walkins,
    compliant,
    notes,
    bigBillAmount: intent === 'big_bill' ? null : bigBillAmount,  // avoid double-count
    confidence: intent === 'other' ? 0.2 : 0.9,
  };
}

// Grab the big-bill value from strings like "Big Bill Value – 25197",
// "🤩Wow Big Bill🤩 ... Value – 25197" or "Big bill 45000". Tries a labeled
// Value/Amount field first, then falls back to a number near the "big bill"
// keyword.
function extractBigBillAmount(t) {
  const valueRaw = findFieldValue(t, 'value|amount|amt|total\\s*value');
  const valueAmt = valueRaw ? parseAmount(valueRaw) : null;
  if (valueAmt != null) return valueAmt;
  const near = t.match(/(?:big\s*bill|major\s*sale|hvb)[^0-9\n]{0,80}(\d[\d,]*(?:\.\d+)?\s*[kKlLmM]?)/i);
  return near ? parseAmount(near[1]) : null;
}

function firstNumberInMessage(text) {
  const m = text.match(/\d[\d,]*(?:\.\d+)?\s*[kKlLmM]?/);
  return m ? m[0] : null;
}

function empty(intent) {
  return { intent, date: null, amount: null, bills: null, walkins: null, compliant: null, notes: null, confidence: 0 };
}
