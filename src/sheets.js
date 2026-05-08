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

export async function initSheets() {
  const id = process.env.GOOGLE_SHEET_ID;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!id || !email || !key) {
    console.warn('[sheets] missing env — sheet sync disabled');
    return null;
  }
  const jwt = new JWT({ email, key, scopes: SCOPES });
  doc = new GoogleSpreadsheet(id, jwt);
  await doc.loadInfo();

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
