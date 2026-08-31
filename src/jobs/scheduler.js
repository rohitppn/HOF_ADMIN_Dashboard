import cron from 'node-cron';
import { sendTo } from '../bot.js';
import { templates } from '../templates.js';
import { MAIN_GROUP_JID, MANAGER_GROUP_JID, HOURLY_SLOTS, EOD_TIME, TIMEZONE } from '../config.js';
import { dailyRanking } from '../calc.js';
import { todayDate } from '../util.js';
import { appendRankings } from '../sheets.js';

const opts = { timezone: TIMEZONE };

// Single-group model — all managers are in one group, so a "broadcast" is
// exactly one send. No-op silently if the group isn't configured yet.
function promptGroup(text) {
  if (!MAIN_GROUP_JID) return Promise.resolve();
  return sendTo(MAIN_GROUP_JID, text).catch((e) => console.error('[cron] send fail:', e.message));
}

// What the bot posts on its own, on a schedule:
//   • Hourly @mention prompts at 1 / 3 / 5 / 7 / 9 PM (asked for explicitly)
//   • End-of-day ranking to the leadership group
//
// Disabled by default (uncomment below if you ever want them back):
//   • 10:00 opening-balance prompt
//   • 10:31 late-opening nudge to leadership
//   • 11:00 grooming compliance prompt
//   • 22:00 DSR prompt
export function startSchedulers() {
  // Hourly check-ins — @mention every store manager, ask for the past hour's sales.
  for (const slot of HOURLY_SLOTS) {
    cron.schedule(`${slot.minute} ${slot.hour} * * *`, () => promptGroup(templates.promptHourly(slot.hour)), opts);
  }

  // Daily ranking post-EOD to the leadership group (23:00 by default).
  cron.schedule(`${EOD_TIME.minute} ${(EOD_TIME.hour + 1) % 24} * * *`, async () => {
    if (!MANAGER_GROUP_JID) return;
    const date = todayDate();
    const rows = await dailyRanking(date);
    await sendTo(MANAGER_GROUP_JID, templates.dailyRanking({ date, rows }));
    await appendRankings(date, rows.filter((r) => r.rank).map((r) => ({
      rank: r.rank, store: r.store, total_sales: r.total_sales, target: r.target, achievement_pct: r.achievement_pct,
    }))).catch((e) => console.error('[cron] sheet rankings:', e.message));
  }, opts);

  console.log('[cron] schedulers started — hourly prompts + daily ranking only');
}
