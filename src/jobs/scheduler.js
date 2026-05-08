import cron from 'node-cron';
import { sendTo } from '../bot.js';
import { templates } from '../templates.js';
import { STORES, MANAGER_GROUP_JID, HOURLY_SLOTS, EOD_TIME, OPENING_DEADLINE, TIMEZONE } from '../config.js';
import { dailyRanking, missingReports } from '../calc.js';
import { todayDate } from '../util.js';
import { appendRankings } from '../sheets.js';

const opts = { timezone: TIMEZONE };

function broadcastToStores(text) {
  return Promise.all(STORES.map((s) => sendTo(s.groupJid, text).catch((e) => console.error('[cron] send fail', s.key, e.message))));
}

export function startSchedulers() {
  // Morning opening-balance prompt at 10:00.
  cron.schedule('0 10 * * *', () => broadcastToStores(templates.promptOpeningBalance()), opts);

  // Late-opening reminder one minute past the deadline.
  cron.schedule(`${OPENING_DEADLINE.minute + 1} ${OPENING_DEADLINE.hour} * * *`, async () => {
    const date = todayDate();
    const missing = missingReports(date, 'opening');
    if (missing.length && MANAGER_GROUP_JID) {
      await sendTo(MANAGER_GROUP_JID, templates.missingReport({ kind: 'store opening (past 10:30)', stores: missing }));
    }
  }, opts);

  // Hourly check-ins.
  for (const slot of HOURLY_SLOTS) {
    const label = `${String(slot.hour).padStart(2, '0')}:${String(slot.minute).padStart(2, '0')}`;
    cron.schedule(`${slot.minute} ${slot.hour} * * *`, () => broadcastToStores(templates.promptHourly(label)), opts);
  }

  // Grooming check-in around store opening (11:00).
  cron.schedule('0 11 * * *', () => broadcastToStores(templates.promptGrooming()), opts);

  // EOD: ask DSR, then 30 minutes later post the ranking.
  cron.schedule(`${EOD_TIME.minute} ${EOD_TIME.hour} * * *`, () => broadcastToStores(templates.promptDsr()), opts);

  cron.schedule(`${EOD_TIME.minute} ${(EOD_TIME.hour + 1) % 24} * * *`, async () => {
    if (!MANAGER_GROUP_JID) return;
    const date = todayDate();
    const rows = dailyRanking(date);
    await sendTo(MANAGER_GROUP_JID, templates.dailyRanking({ date, rows }));
    await appendRankings(date, rows.filter((r) => r.rank).map((r) => ({
      rank: r.rank, store: r.store, total_sales: r.total_sales, target: r.target, achievement_pct: r.achievement_pct,
    }))).catch((e) => console.error('[cron] sheet rankings:', e.message));
  }, opts);

  console.log('[cron] schedulers started');
}
