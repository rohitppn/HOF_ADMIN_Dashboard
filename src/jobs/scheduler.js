import cron from 'node-cron';
import { sendTo } from '../bot.js';
import { templates } from '../templates.js';
import { MAIN_GROUP_JID, MANAGER_GROUP_JID, HOURLY_SLOTS, EOD_TIME, OPENING_DEADLINE, TIMEZONE } from '../config.js';
import { dailyRanking, missingReports } from '../calc.js';
import { todayDate } from '../util.js';
import { appendRankings } from '../sheets.js';

const opts = { timezone: TIMEZONE };

// Single-group model — all managers are in one group, so a "broadcast" is
// exactly one send. No-op silently if the group isn't configured yet.
function promptGroup(text) {
  if (!MAIN_GROUP_JID) return Promise.resolve();
  return sendTo(MAIN_GROUP_JID, text).catch((e) => console.error('[cron] send fail:', e.message));
}

export function startSchedulers() {
  // Morning opening-balance prompt at 10:00.
  cron.schedule('0 10 * * *', () => promptGroup(templates.promptOpeningBalance()), opts);

  // Late-opening reminder one minute past the deadline.
  cron.schedule(`${OPENING_DEADLINE.minute + 1} ${OPENING_DEADLINE.hour} * * *`, async () => {
    const date = todayDate();
    const missing = await missingReports(date, 'opening');
    if (missing.length && MANAGER_GROUP_JID) {
      await sendTo(MANAGER_GROUP_JID, templates.missingReport({ kind: 'store opening (past 10:30)', stores: missing }));
    }
  }, opts);

  // Hourly check-ins — at each slot, @mention every store manager in the
  // main group and ask for the previous hour's sales.
  for (const slot of HOURLY_SLOTS) {
    cron.schedule(`${slot.minute} ${slot.hour} * * *`, () => promptGroup(templates.promptHourly(slot.hour)), opts);
  }

  // Grooming check-in around store opening (11:00).
  cron.schedule('0 11 * * *', () => promptGroup(templates.promptGrooming()), opts);

  // EOD: ask DSR, then an hour later post the ranking to the leadership group.
  cron.schedule(`${EOD_TIME.minute} ${EOD_TIME.hour} * * *`, () => promptGroup(templates.promptDsr()), opts);

  cron.schedule(`${EOD_TIME.minute} ${(EOD_TIME.hour + 1) % 24} * * *`, async () => {
    if (!MANAGER_GROUP_JID) return;
    const date = todayDate();
    const rows = await dailyRanking(date);
    await sendTo(MANAGER_GROUP_JID, templates.dailyRanking({ date, rows }));
    await appendRankings(date, rows.filter((r) => r.rank).map((r) => ({
      rank: r.rank, store: r.store, total_sales: r.total_sales, target: r.target, achievement_pct: r.achievement_pct,
    }))).catch((e) => console.error('[cron] sheet rankings:', e.message));
  }, opts);

  console.log('[cron] schedulers started');
}
