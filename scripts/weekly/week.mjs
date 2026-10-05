// The weekly report's window, in San Francisco time: the 7 full days before the send day's most
// recent Wednesday (Wed 00:00 to Tue 24:00), and the 7 days before that for comparison. Shared by
// every source in scripts/weekly/sources/ so all sections describe the same week.
export const TZ = 'America/Los_Angeles';
const DAY = 86400000;

const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short',
});
const wall = (ms) => Object.fromEntries(fmt.formatToParts(ms).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));

/** 'YYYY-MM-DD' of the San Francisco calendar day containing ms. */
export const ymd = (ms) => { const p = wall(ms); return `${p.year}-${p.month}-${p.day}`; };

/** 'YYYY-MM-DD' shifted by n calendar days (DST-proof: plain date math on UTC noon). */
export const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** Epoch ms of 00:00 San Francisco time on day 'YYYY-MM-DD'. */
export function midnight(day) {
  const target = Date.parse(`${day}T00:00:00Z`);
  let t = target + 8 * 3600000; // PST guess, then correct by the wall-clock difference (twice covers DST edges)
  for (let i = 0; i < 2; i++) {
    const p = wall(t);
    t -= Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - target;
  }
  return t;
}

const label = (day, opts) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });

/**
 * The report week for a send time. end = 00:00 of the most recent Wednesday on or before `now`
 * (San Francisco), start = 7 days earlier. Instants are epoch ms; `until` values are exclusive.
 */
export function reportWeek(now = Date.now()) {
  const today = ymd(now);
  const back = (['Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue'].indexOf(wall(now).weekday) + 7) % 7;
  const endDay = addDays(today, -back);            // the Wednesday the window ends on (exclusive)
  const startDay = addDays(endDay, -7);
  const prevStartDay = addDays(endDay, -14);
  const days = Array.from({ length: 7 }, (_, i) => addDays(startDay, i));
  const prevDays = Array.from({ length: 7 }, (_, i) => addDays(prevStartDay, i));
  const last = days[6];
  const sameMonth = startDay.slice(0, 7) === last.slice(0, 7);
  return {
    tz: TZ,
    start: midnight(startDay), end: midnight(endDay),
    prevStart: midnight(prevStartDay), prevEnd: midnight(startDay),
    days, prevDays,
    label: `${label(startDay, { month: 'short', day: 'numeric' })} to ${label(last, sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' })}`,
  };
}
