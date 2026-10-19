#!/usr/bin/env node
// Switches a city's winter rule (city.json `winter`: Madison's alternate side parking) on, off or paused, in
// data/<id>/winter.json: the file its page reads before drawing (lib/city.js) and the alert server reads for its pushes
// (lib/cities.js). Nothing changes on curb.guide until the file is committed and deployed.
//
//   node scripts/cities/winter.mjs madison on [--from YYYY-MM-DD] [--reason "Madison called its first plowing."]
//   node scripts/cities/winter.mjs madison paused [--reason "…"]
//   node scripts/cities/winter.mjs madison waiting
//
// on: enforced from the night whose window falls on --from (the morning's date, as the ordinance counts them); by default
// the coming night (tonight's window, or this morning's while it is still open), or the season's first if that is later.
// Watches with the rule get one "starts tonight" push (the reason, then which side to park on) until that first night is
// over, then the night push of every night their side closes. paused / waiting: no winter pushes, and the page says so.
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import '../../lib/sweep-core.js';
import '../../lib/city.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The morning date ("YYYY-MM-DD") of the night people are in at `now`, in the city's time zone: today's until the
 *  window ends, then tomorrow's (lib/city.js winterNight). */
export const comingNight = (now, city) => globalThis.makeCity(city).winterNight(now).iso;

/** The switch file's content for a state, or throws on a bad request. */
export function switchTo(state, { from, reason, now = Date.now(), city }) {
  if (!['on', 'paused', 'waiting'].includes(state)) throw new Error(`state must be on, paused or waiting, not "${state}"`);
  if (!city || !city.winter) throw new Error('this city has no winter rule (city.json winter)');
  const out = { state };
  if (state === 'on') {
    const coming = comingNight(now, city);
    out.from = from || (coming < city.winter.from ? city.winter.from : coming);   // switched on early: from the season's first night
    if (!/^\d{4}-\d{2}-\d{2}$/.test(out.from)) throw new Error(`--from must be YYYY-MM-DD, not "${out.from}"`);
    if (out.from < city.winter.from || out.from > city.winter.to) throw new Error(`--from ${out.from} is outside the season (${city.winter.from} to ${city.winter.to})`);
  }
  if (state !== 'waiting') out.at = new Date(now).toISOString();
  if (reason) out.reason = String(reason).trim().slice(0, 140);
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [id, state, ...rest] = process.argv.slice(2);
  const opt = (k) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : undefined; };
  if (!id || !state) { console.error('usage: node scripts/cities/winter.mjs <id> on|paused|waiting [--from YYYY-MM-DD] [--reason "…"]'); process.exit(2); }
  const city = JSON.parse(fs.readFileSync(`${ROOT}data/${id}/city.json`, 'utf8'));
  const out = switchTo(state, { from: opt('--from'), reason: opt('--reason'), city });
  fs.writeFileSync(`${ROOT}data/${id}/winter.json`, JSON.stringify(out, null, 1) + '\n');
  console.error(`[winter] data/${id}/winter.json: ${JSON.stringify(out)}. Commit and push it: the page and the alerts follow the deploy.`);
}
