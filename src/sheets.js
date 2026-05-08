import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

const TABS = {
  opening_balance: ['date', 'store', 'amount', 'reported_at', 'raw_text'],
  store_open:      ['date', 'store', 'opened_at', 'late', 'raw_text'],
  hourly_sales:    ['date', 'store', 'slot', 'sales', 'bills', 'walkins', 'reported_at', 'raw_text'],
  big_bills:       ['date', 'store', 'amount', 'reported_at', 'raw_text'],
  grooming:        ['date', 'store', 'compliant', 'notes', 'reported_at', 'raw_text'],
  dsr:             ['date', 'store', 'total_sales', 'total_bills', 'walkins', 'conversion', 'reported_at', 'raw_text'],
  rankings:        ['date', 'rank', 'store', 'total_sales', 'target', 'achievement_pct'],
};

let doc = null;

function normalizePrivateKey(raw) {
  if (!raw) return null;
  let k = raw.trim();
  // Strip surrounding double quotes if pasted along with them.
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) {
    k = k.slice(1, -1);
  }
  // Convert literal \n into real newlines (idempotent — no-op if already real).
  if (k.includes('\\n')) k = k.replace(/\\n/g, '\n');
  return k;
}

export async function initSheets() {
  const id = process.env.GOOGLE_SHEET_ID;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = normalizePrivateKey(process.env.GOOGLE_PRIVATE_KEY);
  if (!id || !email || !key) {
    console.warn('[sheets] missing env — sheet sync disabled');
    return null;
  }
  // Quick PEM sanity check so we fail with a clear message instead of the cryptic OSSL one.
  if (!key.startsWith('-----BEGIN PRIVATE KEY-----') || !key.trim().endsWith('-----END PRIVATE KEY-----')) {
    console.error('[sheets] GOOGLE_PRIVATE_KEY does not look like a PEM. First 40 chars:', JSON.stringify(key.slice(0, 40)));
    console.error('[sheets] Disabling sheets sync. Fix the env var and redeploy.');
    return null;
  }
  const jwt = new JWT({ email, key, scopes: SCOPES });
  doc = new GoogleSpreadsheet(id, jwt);
  try {
    await doc.loadInfo();
  } catch (e) {
    console.error('[sheets] auth failed:', e.message);
    console.error('[sheets] Disabling sheets sync. Check GOOGLE_PRIVATE_KEY and that the sheet is shared with', email);
    doc = null;
    return null;
  }

  for (const [title, headers] of Object.entries(TABS)) {
    let sheet = doc.sheetsByTitle[title];
    if (!sheet) {
      sheet = await doc.addSheet({ title, headerValues: headers });
    } else {
      await sheet.loadHeaderRow().catch(() => sheet.setHeaderRow(headers));
    }
  }
  console.log('[sheets] connected');
  return doc;
}

export async function appendRow(tab, row) {
  if (!doc) return;
  const sheet = doc.sheetsByTitle[tab];
  if (!sheet) throw new Error(`unknown sheet tab: ${tab}`);
  await sheet.addRow(row);
}

export async function appendRankings(date, rows) {
  if (!doc) return;
  const sheet = doc.sheetsByTitle.rankings;
  await sheet.addRows(rows.map((r) => ({ date, ...r })));
}
