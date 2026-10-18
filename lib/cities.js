// The cities a saved Sweep alert can belong to, for the server side of alerts (api/_schedule.js, lib/notify-core.js,
// api/send-notifications.js, api/test-notification.js). A spot with no `city` is San Francisco: every watch saved
// before Boston keeps working exactly as it did. Per city: its time core (lib/sweep-core.js makeTimeCore; Boston's
// from lib/city-boston.js, which in Node only attaches globalThis.BOS), the page a push opens, how long a watch keeps
// re-arming without a refresh, and the local facts its push copy may state.
import './sweep-core.js';
import './city-boston.js';
import './city-configs.js';
import './city.js';

const G = globalThis;
const SF = {
  id: 'sf', tz: 'America/Los_Angeles', home: '/',
  core: { nextSweep: G.nextSweep, alertAnchors: G.alertAnchors, mornAllowed: G.mornAllowed, parts: G.sfParts, wallToInstant: G.sfWallToInstant },
  isHolidayRow: G.isHolidayRow, holidayScheduleDay: G.holidayScheduleDay,   // SF's posted holiday schedules
  watchAge: 120 * 864e5,   // the page's WATCH_MAX_AGE must equal it (ios/page-bridge.test.mjs)
  blockLink: (cnn, side) => '/b/' + cnn + (side ? '?side=' + side : ''),
  fine: '$105', firstMinutes: ' ~77% of tickets land in the first 45 min.',
};
const BOSTON = {
  id: 'boston', tz: 'America/New_York', home: '/boston',
  core: G.BOS.core,        // Eastern time, the City's holidays (daytime sweeping off, overnight on), seasons by `months`
  isHolidayRow: () => false, holidayScheduleDay: () => false,   // no posted holiday schedules
  // swept April to November: a watch last refreshed in November must still re-arm for April
  watchAge: 165 * 864e5,
  blockLink: (cnn, side) => '/boston?b=' + cnn + (side ? '&side=' + side : ''),
  fine: '$40', firstMinutes: '',   // no ticket data: no claim about when tickets land
};

// Every city built by docs/multi-city/city-build.md (lib/city-configs.js): its own time core from its city.json, a
// watch that keeps re-arming through a season's break, its map's block links, and its fine.
const OTHERS = Object.fromEntries(Object.values(G.CITY_CONFIGS || {}).map((cfg) => [cfg.id, {
  id: cfg.id, tz: cfg.tz, home: '/' + cfg.id,
  core: G.makeCity(cfg).core,
  isHolidayRow: () => false, holidayScheduleDay: () => false,
  watchAge: 165 * 864e5,
  blockLink: (cnn, side) => '/' + cfg.id + '?b=' + cnn + (side ? '&side=' + side : ''),
  fine: cfg.fine || '', firstMinutes: '',
}]));

export const CITIES = { sf: SF, boston: BOSTON, ...OTHERS };
/** The city of a saved spot (no city = San Francisco). */
export const cityOf = (spot) => (spot && spot.city && spot.city !== 'sf' && CITIES[spot.city]) || SF;
