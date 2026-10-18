#!/usr/bin/env node
// Hoboken for CURB (built 2026-10-18, by docs/multi-city/city-build.md). Writes data/hoboken/ from three City of
// Hoboken sources:
//
//   1. The alternate side parking schedule in the Hoboken Code, § 190-28 (ecode360.com/15236904): street, side, day and
//      hour, and the stretch it covers. It is the law, it is amended through 2021, and the City's own schedule page
//      sends residents to it "for the most current alternate side parking regulations". ecode360 refuses scripts (a
//      browser check), so its rows are transcribed below (CODE_ROWS, read 2026-10-18) and the build checks them against
//      the City's web page and map layer every run.
//   2. "Hoboken Streets" (ArcGIS, last edited 2019-12-03): the street lines, block by block, with an older copy of the
//      same schedule per block side (STREETCLEANINGN/S/E/W). Lines and cross streets come from here.
//   3. The City's Street Cleaning Schedule page (hobokennj.gov), a list copied from the Code at some point: compared,
//      never used for a rule.
//
// Where the Code and the layer differ, the Code wins and every difference goes to report.json. The rule: weekly, all
// year, one posted hour per side (Washington St: every weekday morning). $50 (§ 190-44). Suspended on the City's
// holidays (hobokennj.gov/holiday-schedule) and some storm days. Towing only where a Tow Away Zone sign is posted
// (§ 190-44B). PRIVACY: the City also publishes a permit holders layer with names and plates; this build never reads it.
//
// Run: node scripts/cities/hoboken.mjs [--refresh]   (Node 18+; inputs cached in private/cache/hoboken/)
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = ROOT + 'data/hoboken/';
const CACHE = process.env.CURB_CACHE_DIR || ROOT + 'private/cache/hoboken/';
const REFRESH = process.argv.includes('--refresh');
const log = (...a) => console.error('[hoboken]', ...a);

export const STREETS = 'https://services8.arcgis.com/LDmC4ZVHdfKcEzxl/arcgis/rest/services/Hoboken_Streets/FeatureServer/0';
export const PAGE = 'https://www.hobokennj.gov/resources/street-cleaning-schedule';
export const CODE_URL = 'https://ecode360.com/15236904';
export const FINES_URL = 'https://ecode360.com/15237075';
export const HOLIDAYS_URL = 'https://hobokennj.gov/holiday-schedule';
export const LAYER_FIELDS = ['FID', 'FULLNAME', 'STREETCLEANINGN', 'STREETCLEANINGS', 'STREETCLEANINGE', 'STREETCLEANINGW'];

// ---------- the Code's schedule -------------------------------------------------------------------

// § 190-28, Alternate parking locations, as ecode360 shows it on 2026-10-18 (street | side | days/hours | location), in
// the Code's order and words. Repealed rows (Vezzetti Way 2016, two Washington Street rows 2010, one Observer Highway
// row 2016) are left out. The amendment notes are kept after a #.
export const CODE_ROWS = `
Adams Street|West|Monday/ 11:00 a.m. to 12:00 noon|Newark Street to Sixteenth Street
Adams Street|East|Tuesday/ 11:00 a.m. to 12:00 noon|Newark Street to Sixteenth Street
Bloomfield Street|East|Monday/ 11:00 a.m. to 12:00 noon|Observer Highway to north boundary
Bloomfield Street|West|Tuesday/ 11:00 am. to 12:00 noon|Observer Highway to north boundary
Castle Point Terrace|East|Wednesday/ 1:00 p.m. to 2:00 p.m.|Eighth Street and Tenth Street
Castle Point Terrace|West|Friday/ 1:00 p.m. to 2:00 p.m.|Eighth Street to Tenth Street
Clinton Street|West|Monday/ 9:00 a.m. to 10:00 a.m.|Newark Street to Seventeenth Street
Clinton Street|East|Tuesday/ 9:00 a.m. to 10:00 a.m.|Newark Street to Seventeenth Street
Eighth Street|North|Wednesday/ 3:00 p.m. to 4:00 p.m.|Willow Avenue to Jackson Street
Eighth Street|South|Wednesday/ 1:00 p.m. to 2:00 p.m.|East boundary to Willow Avenue
Eighth Street|North|Friday/ 1:00 p.m. to 2:00 p.m.|East boundary to Willow Avenue
Eighth Street|South|Friday/ 3:00 p.m. to 4:00 p.m.|Willow Avenue to Jackson Street
Eleventh Street|North|Tuesday/ 10:00 a.m. to 11:00 a.m.|Hudson Street to Willow Avenue
Eleventh Street|South|Wednesday/ 2:00 p.m. to 3:00 p.m.|Willow Avenue to Hudson Street
Eleventh Street|South|Thursday/ 3:00 p.m. to 4:00 p.m.|Willow Avenue to Monroe Street
Eleventh Street|North|Friday/ 3:00 p.m. to 4:00 p.m.|Willow Avenue to Monroe Street
Fifteenth Street|North|Friday/ 3:00 p.m. to 4:00 p.m.|Park Avenue to Madison Street
Fifteenth Street|North|Wednesday/ 3:00 p.m. to 4:00 p.m.|Sinatra Drive to Park Avenue  # Added 11-5-2020 by Ord. No. B-308
Fifteenth Street|South|Wednesday/ 3:00 p.m. to 4:00 p.m.|Park Avenue to Madison Street
Fifteenth Street|South|Wednesday/ 3:00 p.m. to 4:00 p.m.|Sinatra Drive to Park Avenue  # Added 5-19-2004 by Ord. No. DR-142
Fifth Street|North|Monday/ 3:00 p.m. to 4:00 p.m.|Jackson Street to Grand Street
Fifth Street|South|Tuesday/ 3:00 p.m. to 4:00 p.m.|Jackson Street to Grand Street
Fifth Street|North|Wednesday/ 11:00 a.m. to 12:00 noon|Clinton Street to Sinatra Drive
Fifth Street|South|Thursday/ 11:00 a.m. to 12:00 noon|Clinton Street to Sinatra Drive
First Street|North|Monday/ 2:00 p.m. to 3:00 p.m.|Marshall Street to Willow Avenue
First Street|South|Tuesday/ 2:00 p.m. to 3:00 p.m.|Marshall Street to Willow Avenue
First Street|North|Wednesday/ 10:00 a.m. to 11:00 a.m.|River Street to Willow Avenue
First Street|South|Thursday/ 10:00 a.m. to 11:00 a.m.|Willow Avenue to River Street
Fourteenth Street|North|Wednesday/ 8:00 a.m. to 9:00 a.m.|Sinatra Drive to Willow Avenue  # Amended 11-5-2020 by Ord. No. B-308
Fourteenth Street|South|Monday/ 8:00 a.m. to 9:00 a.m.|Willow Avenue to Sinatra Drive  # Amended 11-5-2020 by Ord. No. B-308
Fourth Street|North|Monday/ 3:00 p.m. to 4:00 p.m.|Willow Avenue to Harrison Street
Fourth Street|South|Tuesday/ 3:00 p.m. to 4:00 p.m.|Willow Avenue to Harrison Street
Fourth Street|North|Wednesday/ 11:00 a.m. to 12:00 noon|River Street to Willow Avenue
Fourth Street|South|Thursday/ 11:00 a.m. to 12:00 noon|River Street to Willow Avenue
Garden Street|East|Monday/ 2:00 p.m. to 3:00 p.m.|Fourteenth Street to Observer Highway
Garden Street|West|Tuesday/ 2:00 p.m. to 3:00 p.m.|Fourteenth Street to Observer Highway
Grand Street|East|Thursday/ 1:00 p.m. to 2:00 p.m.|Sixteenth Street to Newark Street
Grand Street|West|Friday/ 1:00 p.m. to 2:00 p.m.|Sixteenth Street to Newark Street
Grand Street|East|Thursday/ 2:00 p.m. to 3:00 p.m.|Eleventh Street to Tenth Street  # Added 10-16-2002 by Ord. No. DR-65
Grand Street|West|Wednesday/ 2:00 p.m. to 3:00 p.m.|Eleventh Street to Tenth Street  # Added 10-16-2002 by Ord. No. DR-65
Grove Street|Both|Monday/ 1:00 p.m. to 2:00 p.m.|Newark Street to the south boundary
Harrison Street|East|Monday/ 3:00 p.m. to 4:00 p.m.|Fifth Street to the northern boundary  # Added 11-3-2010 by Ord. No. Z-67
Harrison Street|East|Thursday/ 2:00 p.m. to 3:00 p.m.|Fourth Street to Newark Street
Harrison Street|West|Friday/ 2:00 p.m. to 3:00 p.m.|Fourth Street to Newark Street
Henderson Street|Both|Monday/ 1:00 p.m. to 2:00 p.m.|Newark Street to south boundary
Hudson Place|South|Thursday/ 8:00 a.m. to 9:00 a.m.|Hudson Street to east boundary
Hudson Place|North|Friday/ 8:00 a.m. to 9:00 a.m.|Hudson Street to east boundary
Hudson Street|West|Wednesday/ 10:00 a.m. to 11:00 a.m.|Fourteenth Street to Observer Highway
Hudson Street|East|Friday/ 10:00 a.m. to 11:00 a.m.|Fourteenth Street to Observer Highway
Hudson Street|East|Friday/ 10:00 a.m. to 11:00 a.m.|Fourteenth Street to Fifteenth Street  # Added 5-19-2004 by Ord. No. DR-142
Hudson Street|West|Wednesday/ 10:00 a.m. to 11:00 a.m.|Fourteenth Street to Fifteenth Street  # Added 5-19-2004 by Ord. No. DR-142
Jackson Street|East|Thursday/ 2:00 p.m. to 3:00 p.m.|Newark Street to north boundary
Jackson Street|West|Friday/ 2:00 p.m. to 3:00 p.m.|Newark Street to north boundary
Jefferson Street|East|Thursday/ 10:00 a.m. to 11:00 a.m.|Sixteenth Street to Observer Highway
Jefferson Street|West|Friday/ 10:00 a.m. to 11:00 a.m.|Sixteenth Street to Observer Highway
Madison Street|East|Thursday/ 9:00 a.m. to 10:00 a.m.|Newark Street to Fifteenth Street
Madison Street|West|Friday/ 9:00 a.m. to 10:00 a.m.|Newark Street to Fifteenth Street
Marshall Street|Both|Thursday/ 2:00 p.m. to 3:00 p.m.|First Street to Second Street
Monroe Street|West|Monday/ 1:00 p.m. to 2:00 p.m.|Eleventh Street to Newark Street
Monroe Street|East|Tuesday/ 1:00 p.m. to 2:00 p.m.|Eleventh Street to Newark Street
Newark Street|Both|Monday/ 1:00 p.m. to 2:00 p.m.|Henderson Street to west boundary
Newark Street|South|Thursday/ 8:00 a.m. to 9:00 a.m.|Washington Street to east boundary
Newark Street|South|Thursday/ 10:00 a.m. to 11:00 a.m.|Washington Street to Willow Avenue
Newark Street|South|Thursday/ 11:00 a.m. to 12:00 noon|Willow Avenue to Jefferson Street
Newark Street|North|Friday/ 11:00 a.m. to 12:00 noon|Washington Street to Jefferson Street
Newark Street|North|Friday/ 8:00 a.m. to 9:00 a.m.|Washington Street to north boundary
Ninth Street|North|Friday/ 3:00 p.m. to 4:00 p.m.|Jackson Street to Willow Avenue  # Amended 7-7-2021 by Ord. No. B-371
Ninth Street|North|Wednesday/ 1:00 p.m. to 2:00 p.m.|Willow Avenue to east boundary
Ninth Street|South|Wednesday/ 3:00 p.m. to 4:00 p.m.|Jackson Street to Willow Avenue  # Amended 7-7-2021 by Ord. No. B-371
Ninth Street|South|Friday/ 1:00 p.m. to 2:00 p.m.|Willow Avenue to east boundary
Observer Highway|Both|Thursday/ 11:00 a.m. to 12:00 noon|Jefferson Street to Monroe Street
Observer Highway|Both|Friday/ 11:00 a.m. to 12:00 noon|Hudson Street to Henderson Street  # Amended 2-3-2016 by Ord. No. Z-394; 9-21-2016 by Ord. No. Z-435
Park Avenue|East|Monday/ 1:00 p.m. to 2:00 p.m.|Observer Highway to Fourteenth Street
Park Avenue|West|Tuesday/ 1:00 p.m. to 2:00 p.m.|Observer Highway to Fourteenth Street
Paterson Avenue|Both|Thursday/ 11:00 a.m. to 12:00 noon|Monroe Street to west boundary
River Street|Both|Tuesday/ 8:00 a.m. to 9:00 a.m.|Hudson Place to Fourth Street
River Terrace|East|Wednesday/ 11:00 a.m. to 12:00 noon|Fifth Street to Seventh Street
River Terrace|West|Thursday/ 1:00 p.m. to 2:00 p.m.|Fifth Street to Seventh Street
Second Street|North|Monday/ 2:00 p.m. to 3:00 p.m.|Willow Avenue to Marshall Street
Second Street|South|Tuesday/ 2:00 p.m. to 3:00 p.m.|Willow Avenue to Marshall Street
Second Street|North|Wednesday/ 10:00 a.m. to 11:00 a.m.|River Street to Willow Avenue
Second Street|South|Thursday/ 10:00 a.m. to 11:00 a.m.|River Street to Willow Avenue
Seventh Street|North|Wednesday/ 11:00 a.m. to 12:00 noon|Willow Avenue to Hudson Street
Seventh Street|South|Wednesday/ 3:00 p.m. to 4:00 p.m.|Jackson Street to Willow Avenue
Seventh Street|South|Thursday/ 1:00 p.m. to 2:00 p.m.|Willow Avenue to Hudson Street
Seventh Street|North|Friday/ 3:00 p.m. to 4:00 p.m.|Jackson Street to Willow Avenue
Sinatra Drive|East|Monday/ 10:00 a.m. to 11:00 a.m.|Fourth Street to Eleventh Street  # Added 11-6-2002 by Ord. No. DR-70; amended 10-27-2020 by Ord. No. B-292
Sinatra Drive|West|Monday/ 10:00 a.m. to 11:00 a.m.|Newark Street to Fourth Street  # Added 11-6-2002 by Ord. No. DR-70; amended 10-27-2020 by Ord. No. B-292
Sixteenth Street|South|Wednesday/ 3:00 p.m. to 4:00 p.m.|West boundary to Park Avenue
Sixteenth Street|North|Friday/ 3:00 p.m. to 4:00 p.m.|West boundary to Park Avenue
Sixth Street|North|Monday/ 3:00 p.m. to 4:00 p.m.|Willow Avenue to west boundary
Sixth Street|South|Tuesday/ 3:00 p.m. to 4:00 p.m.|Willow Avenue to west boundary
Sixth Street|North|Wednesday/ 11:00 a.m. to 12:00 noon|River Terrace to Willow Avenue  # Amended 6-21-2017 by Ord. No. Z-504
Sixth Street|South|Thursday/ 1:00 p.m. to 2:00 p.m.|Willow Avenue to east boundary
Tenth Street|South|Wednesday/ 2:00 p.m. to 3:00 p.m.|Hudson Street to Madison Street
Tenth Street|North|Thursday/ 2:00 p.m. to 3:00 p.m.|Hudson Street to Madison Street
Tenth Street|South|Wednesday/ 2:00 p.m. to 3:00 p.m.|Clinton Street to Grand Street  # Added 7-1-1996 by Ord. No. R-191; amended 10-16-2002 by Ord. No. DR-65
Tenth Street|North|Thursday/ 2:00 p.m. to 3:00 p.m.|Clinton Street to Grand Street  # Added 7-1-1996 by Ord. No. R-191; amended 10-16-2002 by Ord. No. DR-65
Third Street|North|Monday/ 2:00 p.m. to 3:00 p.m.|Jackson Street to Willow Avenue
Third Street|South|Tuesday/ 2:00 p.m. to 3:00 p.m.|Jackson Street to Willow Avenue
Third Street|North|Wednesday/ 11:00 a.m. to 12:00 noon|Willow Avenue to River Street
Third Street|South|Thursday/ 11:00 a.m. to 12:00 noon|Willow Avenue to River Street
Thirteenth Street|North|Tuesday/ 10:00 a.m. to 11:00 a.m.|Hudson Street to Willow Avenue
Thirteenth Street|South|Wednesday/ 2:00 p.m. to 3:00 p.m.|Hudson Street to Willow Avenue
Thirteenth Street|South|Thursday/ 3:00 p.m. to 4:00 p.m.|Willow Avenue to Madison Street
Thirteenth Street|North|Friday/ 3:00 p.m. to 4:00 p.m.|Willow Avenue to Madison Street
Twelfth Street|North|Tuesday/ 10:00 a.m. to 11:00 a.m.|Willow Avenue to Hudson Street
Twelfth Street|South|Wednesday/ 2:00 p.m. to 3:00 p.m.|Willow Avenue to Sinatra Drive North  # Amended 10-20-2021 by Ord. No. B-399
Twelfth Street|South|Thursday/ 3:00 p.m. to 4:00 p.m.|West boundary to Willow Avenue
Twelfth Street|North|Friday/ 3:00 p.m. to 4:00 p.m.|West boundary to Willow Avenue
Washington Street|East|Monday, Tuesday, Wednesday, Thursday, Friday/8:00 a.m. to 9:00 a.m.|Observer Highway to Seventh Street, Eighth Street to north boundary  # Amended 11-6-2002 by Ord. No. DR-70; 5-20-2015 by Ord. No. Z-354; 2-6-2019 by Ord. No. B-105
Washington Street|East|Monday, Tuesday, Wednesday, Thursday, Friday/9:00 a.m. to 10:00 a.m.|Seventh Street to Eighth Street  # Added 2-6-2019 by Ord. No. B-105
Washington Street|West|Monday, Tuesday, Wednesday, Thursday, Friday/ 9:00 a.m. to 10:00 a.m.|Between Newark Street and Seventh Street  # Added 2-4-1998 by Ord. No. R-289; amended 5-20-2015 by Ord. No. Z-354
Washington Street|West|9:00 a.m. to 10:00 a.m. Monday through Friday|Southerly curbline of Fifteenth Street to the northerly curbline of Eight Street  # Amended 5-20-2015 by Ord. No. Z-354
Washington Street|West|8:00 a.m. to 9:00 a.m. Monday through Friday|Southerly curbline of Eight Street to the southerly boundary  # Amended 5-20-2015 by Ord. No. Z-354
Willow Avenue|West|Monday/ 10:00 a.m. to 11:00 a.m.|Fourteenth Street to Observer Highway
Willow Avenue|East|Tuesday/ 10:00 a.m. to 11:00 a.m.|Fourteenth Street to Observer Highway
Willow Avenue|Both|Wednesday/ 8:00 a.m. to 9:00 a.m.|Fourteenth Street to north boundary
`;

// Code rows not applied, with the reason (keyed by street|side|location).
export const SET_ASIDE = {
  'Washington Street|West|Between Newark Street and Seventh Street':
    'overlaps the 2015 row for the same side (8 to 9 AM from Eighth Street to the southerly boundary), which the City\'s page and map layer also give there; this 1998 row, amended the same day, reads 9 to 10 AM',
};

// The layer's names for the Code's streets where they differ: the Code's Henderson Street is TIGER's Marin Blvd (the
// name Jersey City gave it), and its River Terrace is the layer's River St north of Fifth Street.
export const LAYER_NAME = { 'Henderson St': 'Marin Blvd' };   // River Terrace: the River St segments north of 5th St (applyCode)
// What CURB calls them on the map: the City's names.
export const SHOW_NAME = { 'Henderson St': 'Henderson St', 'River Ter': 'River Ter' };
// A layer segment with no name, named by its ends (both on Jefferson St, between 12th and 13th St).
export const FIX_NAME = { 524: 'Jefferson St' };

// The City's holidays, on which alternate side parking is suspended (hobokennj.gov/holiday-schedule, read 2026-10-18).
// 2027 is not posted: the same holidays by the same rule (a Saturday holiday observed the Friday before, a Sunday one
// the Monday after, as Independence Day 2026); the Floating Holiday (December 24 in 2026) and New Year's Day 2028
// (observed?) are left out until the City posts them.
export const HOLIDAYS = {
  '2026-01-01': "New Year's Day", '2026-01-19': 'Martin Luther King Jr. Birthday', '2026-02-16': 'Presidents Day', '2026-04-03': 'Good Friday',
  '2026-05-25': 'Memorial Day', '2026-06-19': 'Juneteenth', '2026-07-03': 'Independence Day', '2026-09-07': 'Labor Day',
  '2026-10-12': 'Columbus Day', '2026-11-03': 'Election Day', '2026-11-11': 'Veterans Day', '2026-11-26': 'Thanksgiving Day',
  '2026-11-27': 'Day after Thanksgiving', '2026-12-24': 'Floating Holiday', '2026-12-25': 'Christmas Day',
  '2027-01-01': "New Year's Day", '2027-01-18': 'Martin Luther King Jr. Birthday', '2027-02-15': 'Presidents Day', '2027-03-26': 'Good Friday',
  '2027-05-31': 'Memorial Day', '2027-06-18': 'Juneteenth (observed)', '2027-07-05': 'Independence Day (observed)', '2027-09-06': 'Labor Day',
  '2027-10-11': 'Columbus Day', '2027-11-02': 'Election Day', '2027-11-11': 'Veterans Day', '2027-11-25': 'Thanksgiving Day',
  '2027-11-26': 'Day after Thanksgiving', '2027-12-24': 'Christmas Day (observed)',
};
export const WEEKS = 31, MONTHS = 0, FLAGS = 0;   // every week, all year, stops on holidays, not towable by default

// ---------- parsing -------------------------------------------------------------------------------

const ORD = { FIRST: '1st', SECOND: '2nd', THIRD: '3rd', FOURTH: '4th', FIFTH: '5th', SIXTH: '6th', SEVENTH: '7th', EIGHTH: '8th',
  EIGHT: '8th', NINTH: '9th', TENTH: '10th', ELEVENTH: '11th', TWELFTH: '12th', THIRTEENTH: '13th', FOURTEENTH: '14th', FIFTEENTH: '15th',
  SIXTEENTH: '16th', SEVENTEENTH: '17th', EIGHTEENTH: '18th' };
const TYPE = { STREET: 'St', ST: 'St', AVENUE: 'Ave', AVE: 'Ave', HIGHWAY: 'Hwy', HWY: 'Hwy', PLACE: 'Pl', PL: 'Pl', TERRACE: 'Ter', TER: 'Ter',
  DRIVE: 'Dr', DR: 'Dr', BOULEVARD: 'Blvd', BLVD: 'Blvd', WAY: 'Way', LANE: 'Ln', LN: 'Ln' };
/** "Fifteenth Street" → "15th St", "Sinatra Drive North" → "Sinatra Dr N", "Observer Hwy." → "Observer Hwy". */
export function streetName(s) {
  const w = String(s || '').replace(/[.,*]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const out = w.map((t, i) => {
    const u = t.toUpperCase();
    if (ORD[u]) return ORD[u];
    if (i > 0 && TYPE[u]) return TYPE[u];
    if (i > 0 && u === 'NORTH') return 'N';
    return t[0].toUpperCase() + t.slice(1).toLowerCase();
  });
  return out.join(' ');
}
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
/** "Monday/ 11:00 a.m. to 12:00 noon" → { days: [1], from: 11, to: 12 }; also the page's and layer's wordings. */
export function parseWhen(s) {
  const t = String(s || '').toLowerCase();
  let days;
  if (/monday\s*(through|-|to)\s*friday/.test(t)) days = [1, 2, 3, 4, 5];
  else days = DAYS.map((d, i) => (t.includes(d) ? i : -1)).filter((i) => i >= 0);
  const times = [...t.matchAll(/(\d{1,2})(?::(\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?|noon)/g)].map((m) => {
    let h = +m[1] % 12;
    if (m[3].startsWith('p') || m[3] === 'noon') h += 12;
    if (m[3] === 'noon') h = 12;
    return m[2] && +m[2] ? `${h}:${m[2]}` : h;
  });
  if (!days.length || times.length !== 2) return null;
  return { days, from: times[0], to: times[1] };
}
/** "X to Y" → [['X', 'Y']]; "Between X and Y", "X and Y", the curbline wording, and two stretches split by a comma. */
export function parseLocation(s) {
  return String(s || '').split(/,\s*/).map((part) => {
    const p = part.replace(/southerly curbline of |northerly curbline of |the /gi, '').replace(/^between /i, '').trim();
    const m = /^(.+?)\s+(?:to|and)\s+(.+)$/i.exec(p);
    return m ? [m[1].trim(), m[2].trim()] : null;
  }).filter(Boolean);
}
const SIDE = { NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W', BOTH: 'B' };
/** One Code (or page) row → { street, side, days, from, to, stretches, location, note }. */
export function parseRow(line) {
  const [main, note] = line.split('#').map((x) => x && x.trim());
  const [street, side, when, location] = main.split('|').map((x) => x.trim());
  const w = parseWhen(when);
  return { street: streetName(street), side: SIDE[String(side).toUpperCase()] || null, ...(w || {}), stretches: parseLocation(location),
    location, key: `${street}|${side}|${location}`, ...(note ? { note } : {}), ok: !!w };
}
export const codeRows = () => CODE_ROWS.trim().split('\n').map(parseRow);

/** The City's page: its table rows (each shown twice for small screens), as { street, side, when, location }. */
export function pageRows(html) {
  const text = String(html).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>|<\/(p|div|li|td|th|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;|&#39;|&rsquo;|’/g, "'")
    .split('\n').map((x) => x.replace(/[​-‍﻿]/g, '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const start = text.lastIndexOf('Location') + 1, end = text.findIndex((x, i) => i > start && /^CONTACT INFORMATION/.test(x));
  const cells = text.slice(start, end > 0 ? end : undefined);
  const rows = [], seen = new Set();
  for (let i = 0; i + 3 < cells.length; i += 4) {
    const [street, side, when, location] = cells.slice(i, i + 4);
    const k = [street, side, when, location].join('|');
    if (!/^(North|South|East|West|Both)$/i.test(side)) throw new Error(`the City's page changed shape near "${cells.slice(i, i + 4).join(' | ')}"`);
    if (!seen.has(k)) { seen.add(k); rows.push({ street, side, when, location }); }
  }
  return rows;
}

// ---------- geometry -------------------------------------------------------------------------------

const LAT0 = 40.745, KX = Math.cos(LAT0 * Math.PI / 180) * 111320, KY = 111132;
export const xy = ([lon, lat]) => [lon * KX, lat * KY];
export const round6 = (c) => c.map(([lo, la]) => [Math.round(lo * 1e6) / 1e6, Math.round(la * 1e6) / 1e6]);
const dist = (a, b) => { const p = xy(a), q = xy(b); return Math.hypot(p[0] - q[0], p[1] - q[1]); };
function distToLine(pt, line) {
  const [px, py] = xy(pt);
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [x1, y1] = xy(line[i - 1]), [x2, y2] = xy(line[i]), dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(px - x1 - t * dx, py - y1 - t * dy));
  }
  return best;
}
/** A layer line: a LineString, or a MultiLineString whose parts chain end to start within 3 m. */
export function lineOf(g) {
  if (!g) return null;
  if (g.type === 'LineString') return g.coordinates;
  if (g.type !== 'MultiLineString') return null;
  const parts = g.coordinates.filter((p) => p.length >= 2), line = [...parts[0]];
  for (const p of parts.slice(1)) { if (dist(line[line.length - 1], p[0]) > 3) return null; line.push(...p.slice(1)); }
  return line;
}
/** Which side of a line, looking from its first point to its last, faces the compass direction N|S|E|W. */
export function sideFacing(c, dir) {
  const a = xy(c[0]), b = xy(c[c.length - 1]), dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
  const left = [-dy / len, dx / len], want = { N: [0, 1], S: [0, -1], E: [1, 0], W: [-1, 0] }[dir];
  const dot = left[0] * want[0] + left[1] * want[1];
  return { side: dot > 0 ? 'L' : 'R', clear: Math.abs(dot) > 0.35 };
}
/** The four way name of a side (Hoboken's signs and Code say North, South, East or West). */
export function compass4(c, side) {
  const a = xy(c[0]), b = xy(c[c.length - 1]), dx = b[0] - a[0], dy = b[1] - a[1];
  const [nx, ny] = side === 'L' ? [-dy, dx] : [dy, -dx];
  return Math.abs(nx) > Math.abs(ny) ? (nx > 0 ? 'East' : 'West') : (ny > 0 ? 'North' : 'South');
}

// ---------- the street graph ----------------------------------------------------------------------

/** Layer features → segments: { id, name, c, values: {N,S,E,W} }. */
export function segmentsOf(features) {
  return features.map((f) => {
    const p = f.properties, c = lineOf(f.geometry);
    const name = FIX_NAME[p.FID] || String(p.FULLNAME || '').trim();
    const values = {};
    for (const d of ['N', 'S', 'E', 'W']) { const v = String(p['STREETCLEANING' + d] || '').trim(); if (v) values[d] = v; }
    return { id: String(p.FID), name, c, values };
  }).filter((s) => s.c && s.c.length >= 2);
}
/** The cross street names at a segment's two ends: streets whose lines pass within 6 m of that end. */
export function crossAt(seg, all, end) {
  const pt = end === 0 ? seg.c[0] : seg.c[seg.c.length - 1];
  return [...new Set(all.filter((o) => o !== seg && o.name && o.name !== seg.name && distToLine(pt, o.c) < 6).map((o) => o.name))].sort();
}
/** Where a street meets a cross street: points on the street's line, as positions along the street's axis. */
function axisOf(segs) {
  const pts = segs.flatMap((s) => s.c.map(xy));
  let best = [pts[0], pts[0]], far = 0;
  for (const p of pts) for (const q of pts) { const d = Math.hypot(p[0] - q[0], p[1] - q[1]); if (d > far) { far = d; best = [p, q]; } }
  const [p, q] = best, len = far || 1, u = [(q[0] - p[0]) / len, (q[1] - p[1]) / len];
  return { origin: p, u, at: (lonlat) => { const [x, y] = xy(lonlat); return (x - p[0]) * u[0] + (y - p[1]) * u[1]; } };
}
const sameStreet = (name, want) => name === want || name === want + ' N';   // "Sinatra Drive" meets 14th and 15th St as Sinatra Dr N

/**
 * The street's segments inside one stretch of a Code row ("Newark Street to Sixteenth Street"), or { error }. A limit
 * is a cross street (where it meets the street), or "north boundary" (the street's end that way). A cross street the
 * street never meets (Clinton St's "Seventeenth Street") counts as the street's end beyond the other limit, reported.
 */
export function stretch(street, [from, to], bySt) {
  const segs = bySt.get(street);
  if (!segs || !segs.length) return { error: `no street "${street}" in the layer` };
  const axis = axisOf(segs), notes = [];
  const ends = segs.flatMap((s) => [s.c[0], s.c[s.c.length - 1]]).map((p) => ({ p, t: axis.at(p) }));
  const lo = Math.min(...ends.map((e) => e.t)), hi = Math.max(...ends.map((e) => e.t));
  const loP = ends.find((e) => e.t === lo).p, hiP = ends.find((e) => e.t === hi).p;
  const pos = (name) => {
    const b = /^(north|south|east|west)(?:ern|erly)?\s+boundary$/i.exec(name);
    if (b) {   // the street's end that way
      const [ax, ay] = xy(loP), [bx, by] = xy(hiP);
      return { north: by > ay, south: by < ay, east: bx > ax, west: bx < ax }[b[1].toLowerCase()] ? hi : lo;
    }
    const want = LAYER_NAME[streetName(name)] || streetName(name), hits = [];
    const cross = [...bySt].filter(([n]) => sameStreet(n, want)).flatMap(([, list]) => list);
    const mean = (v) => v.reduce((x, y) => x + y, 0) / v.length;
    // 1. where they meet: a street end on the cross street's line, or a cross street end on the street's line (a T)
    for (const o of cross) for (const s of segs) {
      for (const p of [s.c[0], s.c[s.c.length - 1]]) if (distToLine(p, o.c) < 6) hits.push(axis.at(p));
      for (const p of [o.c[0], o.c[o.c.length - 1]]) if (distToLine(p, s.c) < 6) hits.push(axis.at(p));
    }
    if (hits.length) return mean(hits);
    if (!cross.length) { notes.push(`no ${name} in the layer: read as the street's end`); return null; }
    // 2. where the cross street's line crosses the street's line (the street stops short of it, or skips a block)
    const off = (p) => { const [x, y] = xy(p); return (x - axis.origin[0]) * -axis.u[1] + (y - axis.origin[1]) * axis.u[0]; };
    for (const o of cross) for (let i = 1; i < o.c.length; i++) {
      const d1 = off(o.c[i - 1]), d2 = off(o.c[i]);
      if ((d1 <= 0) !== (d2 <= 0)) {
        const k = d1 / (d1 - d2), t = axis.at(o.c[i - 1]) + k * (axis.at(o.c[i]) - axis.at(o.c[i - 1]));
        if (t > lo - 60 && t < hi + 60) hits.push(Math.max(lo, Math.min(hi, t)));
      }
    }
    if (hits.length) { notes.push(`${name} does not meet ${street} in the layer: placed where its line crosses ${street}'s`); return mean(hits); }
    // 3. the cross street's point nearest the street's line, within 120 m
    let best = null;
    for (const o of cross) for (const p of o.c) { const d = Math.abs(off(p)); if (d < 120 && (!best || d < best.d)) best = { d, t: axis.at(p) }; }
    if (best) { notes.push(`${name} does not reach ${street} in the layer: placed at its nearest point (${Math.round(best.d)} m away)`); return Math.max(lo, Math.min(hi, best.t)); }
    notes.push(`${name} is nowhere near ${street} in the layer: read as the street's end`);
    return null;
  };
  let a = pos(from), b = pos(to);
  if (a === null && b === null) return { error: `neither ${from} nor ${to} meets ${street}` };
  const farEnd = (t) => (t - lo > hi - t ? lo : hi);   // the street's end away from the other limit
  if (a === null) a = farEnd(b);
  if (b === null) b = farEnd(a);
  const [x, y] = a < b ? [a, b] : [b, a];
  const inside = segs.filter((s) => { const m = (axis.at(s.c[0]) + axis.at(s.c[s.c.length - 1])) / 2; return m > x + 1 && m < y - 1; });
  return { segs: inside, notes };
}

// ---------- fetching -------------------------------------------------------------------------------

async function get(url, as = 'json', tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { Accept: as === 'json' ? 'application/json' : 'text/html', 'User-Agent': 'Mozilla/5.0 (curb-hoboken-build; +https://curb.guide)' } });
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      if (as !== 'json') return await r.text();
      const j = await r.json();
      if (j && j.error) throw new Error(`${url}: ${JSON.stringify(j.error)}`);
      return j;
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((res) => setTimeout(res, 2000 * i));
    }
  }
}
async function cached(name, fetcher, raw = false) {
  const f = CACHE + name;
  if (!REFRESH && fs.existsSync(f)) return raw ? fs.readFileSync(f, 'utf8') : JSON.parse(fs.readFileSync(f, 'utf8'));
  const v = await fetcher();
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(f, raw ? v : JSON.stringify(v));
  return v;
}

// ---------- the build ------------------------------------------------------------------------------

const ruleKey = (r) => r.join('|');
const rulesFromWhen = (w) => w.days.map((dow) => [dow, w.from, w.to, WEEKS, MONTHS, FLAGS]);
const DIRS = { N: 'North', S: 'South', E: 'East', W: 'West' };

/** Apply the Code's rows to the layer's segments: { sides: Map(id → Map(L|R → Map(ruleKey → rule))), rows: [...] }. */
export function applyCode(rows, segs) {
  const bySt = new Map();
  for (const s of segs) { if (!bySt.has(s.name)) bySt.set(s.name, []); bySt.get(s.name).push(s); }
  // River Terrace is the layer's River St north of Fifth Street: its own street for matching
  const river = bySt.get('River St') || [], fifth = bySt.get('5th St') || [];
  const meet = river.flatMap((s) => [s.c[0], s.c[s.c.length - 1]]).find((p) => fifth.some((f) => distToLine(p, f.c) < 6));
  if (meet) {
    const cutY = xy(meet)[1], midY = (s) => (xy(s.c[0])[1] + xy(s.c[s.c.length - 1])[1]) / 2;
    const terrace = river.filter((s) => midY(s) > cutY);
    if (terrace.length) { bySt.set('River Ter', terrace); bySt.set('River St', river.filter((s) => midY(s) <= cutY)); }
  }
  const sides = new Map(), out = [];
  for (const row of rows) {
    const rec = { key: row.key, street: row.street, applied: 0, segments: [], notes: [] };
    out.push(rec);
    if (SET_ASIDE[row.key]) { rec.setAside = SET_ASIDE[row.key]; continue; }
    if (!row.ok) { rec.notes.push('days or hours unreadable'); continue; }
    const name = LAYER_NAME[row.street] || row.street;
    for (const st of row.stretches) {
      const r = stretch(name, st, bySt);
      if (r.error) { rec.notes.push(r.error); continue; }
      rec.notes.push(...r.notes);
      for (const s of r.segs) {
        const lr = row.side === 'B' ? [['L', true], ['R', true]] : [[sideFacing(s.c, row.side).side, sideFacing(s.c, row.side).clear]];
        for (const [side, clear] of lr) {
          if (!clear) rec.notes.push(`segment ${s.id}: the ${DIRS[row.side]} side is not clear (the line runs diagonally)`);
          if (!sides.has(s.id)) sides.set(s.id, new Map());
          const m = sides.get(s.id);
          if (!m.has(side)) m.set(side, new Map());
          for (const rule of rulesFromWhen(row)) m.get(side).set(ruleKey(rule), rule);
        }
        rec.segments.push(s.id);
        rec.applied++;
      }
    }
  }
  return { sides, rows: out, bySt };
}

/** The layer's own schedule per segment side, as rule keys, for the comparison. */
export function layerSides(seg) {
  const m = new Map();
  for (const [dir, v] of Object.entries(seg.values)) {
    const w = parseWhen(v);
    if (!w) continue;
    const { side } = sideFacing(seg.c, dir);
    if (!m.has(side)) m.set(side, new Set());
    for (const rule of rulesFromWhen(w)) m.get(side).add(ruleKey(rule));
  }
  return m;
}

const hourWords = (h) => { const v = typeof h === 'number' ? h : +String(h).split(':')[0]; return `${v % 12 || 12} ${v < 12 ? 'AM' : 'PM'}`; };
const describe = (keys) => [...keys].sort().map((k) => { const [d, f, t] = k.split('|'); return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][+d]} ${hourWords(f)} to ${hourWords(t)}`; }).join(', ') || 'none';

async function main() {
  const meta = await cached('streets-meta.json', () => get(`${STREETS}?f=json`));
  const have = new Set((meta.fields || []).map((x) => x.name));
  const missing = LAYER_FIELDS.filter((k) => !have.has(k));
  if (missing.length) throw new Error(`the Hoboken Streets layer changed shape: no ${missing.join(', ')}`);
  const edited = meta.editingInfo && meta.editingInfo.dataLastEditDate ? new Date(meta.editingInfo.dataLastEditDate).toISOString().slice(0, 10) : 'unknown';
  if (edited !== '2019-12-03') log(`NOTE: the layer was edited ${edited} (it was 2019-12-03): check that FIDs still name the same blocks before shipping`);
  const features = await cached('streets.json', async () => {
    log('fetching Hoboken Streets…');
    const q = new URLSearchParams({ where: '1=1', outFields: LAYER_FIELDS.join(','), outSR: '4326', f: 'geojson', orderByFields: 'FID', resultRecordCount: '2000' });
    return (await get(`${STREETS}/query?${q}`)).features;
  });
  const html = await cached('schedule-page.html', () => get(PAGE, 'text'), true);
  if (features.length < 450 || features.length > 650) throw new Error(`expected about 523 street segments, got ${features.length}`);

  const segs = segmentsOf(features);
  const rows = codeRows();
  const bad = rows.filter((r) => !r.ok || !r.side || !r.stretches.length);
  if (bad.length) throw new Error(`Code rows not parsed: ${bad.map((r) => r.key).join('; ')}`);
  const { sides, rows: applied } = applyCode(rows, segs);

  // The comparison with the layer, side by side.
  const cmp = { sidesCompared: 0, same: 0, differ: [], codeOnly: [], layerOnly: [] };
  const byId = new Map(segs.map((s) => [s.id, s]));
  for (const s of segs) {
    const code = sides.get(s.id) || new Map(), layer = layerSides(s);
    for (const side of ['L', 'R']) {
      const a = new Set(code.has(side) ? code.get(side).keys() : []), b = layer.get(side) || new Set();
      if (!a.size && !b.size) continue;
      cmp.sidesCompared++;
      const label = `${s.name} (${crossAt(s, segs, 0).join('/') || 'end'} to ${crossAt(s, segs, 1).join('/') || 'end'}), ${compass4(s.c, side)} side`;
      if (a.size && b.size && [...a].every((k) => b.has(k)) && a.size === b.size) cmp.same++;
      else if (a.size && b.size) cmp.differ.push({ id: s.id, where: label, code: describe(a), layer: describe(b) });
      else if (a.size) cmp.codeOnly.push({ id: s.id, where: label, code: describe(a) });
      else cmp.layerOnly.push({ id: s.id, where: label, layer: describe(b) });
    }
  }
  // The comparison with the City's page, row by row.
  const page = pageRows(html).map((r) => ({ ...r, ...parseRow(`${r.street}|${r.side}|${r.when}|${r.location}`) }));
  const sig = (r) => `${r.street}|${r.side}|${(r.days || []).join(',')}|${r.from}-${r.to}|${r.stretches.map((x) => x.map(streetName).join('>')).join(';')}`;
  const loose = (r) => `${r.street}|${r.side}|${(r.days || []).join(',')}|${r.from}-${r.to}`;
  const codeSig = new Set(rows.map(sig)), pageSig = new Set(page.map(sig)), codeLoose = new Set(rows.map(loose)), pageLoose = new Set(page.map(loose));
  const pageCmp = {
    pageRows: page.length, codeRows: rows.length,
    onlyOnPage: page.filter((r) => !codeSig.has(sig(r))).map((r) => ({ street: r.street, side: r.side, when: r.when, location: r.location, sameHoursInCode: codeLoose.has(loose(r)) })),
    onlyInCode: rows.filter((r) => !pageSig.has(sig(r))).map((r) => ({ key: r.key, sameHoursOnPage: pageLoose.has(loose(r)), ...(r.note ? { note: r.note } : {}) })),
  };

  // Blocks: every segment side the Code applies to.
  const out = [];
  for (const [id, m] of sides) {
    const s = byId.get(id);
    const name = s.name === 'Marin Blvd' ? SHOW_NAME['Henderson St'] : (applied.some((r) => r.street === 'River Ter' && r.segments.includes(id)) ? SHOW_NAME['River Ter'] : s.name);
    const a = crossAt(s, segs, 0), b = crossAt(s, segs, 1);
    const pick = (list) => (list.filter((x) => x !== name)[0] || '');
    const la = pick(a), lb = pick(b);
    out.push({ c: id, s: name, l: la && lb ? (la === lb ? la : `${la} - ${lb}`) : la || lb, g: round6(s.c),
      d: [...m.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([side, rules]) => [side, compass4(s.c, side), [...rules.values()].sort((p, q) => p[0] - q[0] || String(p[1]).localeCompare(String(q[1]), 'en', { numeric: true }))]) });
  }
  out.sort((x, y) => +x.c - +y.c);
  const nSides = out.reduce((n, b) => n + b.d.length, 0), nRules = out.reduce((n, b) => n + b.d.reduce((k, x) => k + x[2].length, 0), 0);

  let w = 180, s0 = 90, e = -180, n0 = -90;
  for (const b of out) for (const [lo, la] of b.g) { w = Math.min(w, lo); e = Math.max(e, lo); s0 = Math.min(s0, la); n0 = Math.max(n0, la); }
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  const bounds = [[r4(s0 - 0.005), r4(w - 0.005)], [r4(n0 + 0.005), r4(e + 0.005)]];

  const fetched = new Date().toISOString().slice(0, 10);
  const sources = [
    { name: 'Hoboken Code § 190-28, Alternate parking locations (the schedule)', url: CODE_URL, license: 'Municipal code (public law), transcribed', fetched },
    { name: 'Hoboken Streets (City of Hoboken GIS): street lines, and an older copy of the schedule for the comparison', url: STREETS,
      license: 'No license stated (public City of Hoboken layer)', fetched, updated: edited },
    { name: 'Street Cleaning Schedule (City of Hoboken), compared only', url: PAGE, license: 'City web page', fetched },
  ];
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(OUT + 'segments.json', JSON.stringify({
    _meta: { city: 'hoboken', time_zone: 'America/New_York', generated: new Date().toISOString(), sources, blocks: out.length, sides: nSides,
      format: 'b[] = {c: Hoboken Streets segment id (FID), s: street, l: cross streets, g: centerline [[lng,lat]] first point to last, d: [[side L|R, North|South|East|West as the City names it, rules]]}; '
        + 'rule = [jsDow, fromH, toH, weeksMask (31 = every week), monthsMask (0 = all year), flags (0 = suspended on City holidays, not towable)]' },
    b: out }));

  const city = {
    id: 'hoboken', name: 'Hoboken', region: 'New Jersey', tz: 'America/New_York',
    center: [40.744, -74.0305], zoom: 15, bounds,
    holidays: HOLIDAYS, holidaysSource: HOLIDAYS_URL, holidayRule: 'all',
    fine: '$50', tow: 'sometimes', fineSource: FINES_URL,
    agency: 'Hoboken Parking Utility', scheduleUrl: PAGE, sources,
    words: {
      rule: 'Alternate side parking for street cleaning, all year: no parking on one side of the street during its posted hour each week (on Washington St, every weekday morning).',
      afterpass: 'A $50 ticket. Towing only where a Tow Away Zone sign is posted. Suspended on City holidays and some storm days.',
      dataNotes: 'Days and hours come from the alternate side parking schedule in the Hoboken Code (section 190-28), placed on the City\'s street map, which carries an older copy of the same schedule; where the two differ, the Code is shown. The sign on the block wins.',
    },
  };
  fs.writeFileSync(OUT + 'city.json', JSON.stringify(city, null, 1));

  const unapplied = applied.filter((r) => !r.setAside && !r.applied);
  const report = {
    generated: new Date().toISOString(),
    inputs: { layerSegments: features.length, layerEdited: edited, layerSegmentsWithSchedule: segs.filter((x) => Object.keys(x.values).length).length,
      codeRows: rows.length, pageRows: page.length },
    output: { blocks: out.length, sides: nSides, rules: nRules, sizeBytes: fs.statSync(OUT + 'segments.json').size },
    codeRows: { applied: applied.filter((r) => r.applied).length, setAside: applied.filter((r) => r.setAside).map((r) => ({ key: r.key, why: r.setAside })),
      notApplied: unapplied.map((r) => ({ key: r.key, notes: r.notes })),
      notes: applied.filter((r) => r.notes.length).map((r) => ({ key: r.key, notes: [...new Set(r.notes)] })) },
    layerVsCode: { sidesCompared: cmp.sidesCompared, same: cmp.same, differ: cmp.differ.length, codeOnly: cmp.codeOnly.length, layerOnly: cmp.layerOnly.length,
      differences: cmp.differ, onlyInCode: cmp.codeOnly, onlyInLayer: cmp.layerOnly },
    pageVsCode: pageCmp,
    names: { 'Marin Blvd': 'shown as Henderson St (the Code\'s name)', 'River St north of 5th St': 'shown as River Ter (the Code\'s River Terrace)',
      'FID 524': 'no name in the layer; Jefferson St by its ends' },
    season: 'All year (no season in the Code).',
    holidays: { source: HOLIDAYS_URL, note: '2026 from the City\'s list; 2027 derived by the same rule; the 2027 Floating Holiday is not known.' },
    fine: { amount: '$50', source: FINES_URL, section: '§ 190-44A, § 190-28 Alternate side street parking (amended 4-22-2026 by Ord. No. J-28)' },
    tow: '§ 190-44B: towing where a section allows it or a Tow Away Zone sign is posted; § 190-28 does not allow it by itself.',
    checks: { tickets: 'No cross check: Hoboken publishes no parking citations with time and place.' },
  };
  fs.writeFileSync(OUT + 'report.json', JSON.stringify(report, null, 1));
  log(`${out.length} blocks, ${nSides} sides, ${nRules} rules; ${applied.filter((r) => r.applied).length} of ${rows.length} Code rows placed`);
  log(`layer vs Code: ${cmp.same} sides same, ${cmp.differ.length} differ, ${cmp.codeOnly.length} only in the Code, ${cmp.layerOnly.length} only in the layer`);
  log(`page vs Code: ${pageCmp.onlyOnPage.length} page rows not in the Code, ${pageCmp.onlyInCode.length} Code rows not on the page`);
  if (unapplied.length) log(`NOT placed: ${unapplied.map((r) => `${r.key} (${r.notes.join('; ')})`).join(' | ')}`);
  for (const f of ['segments.json', 'city.json', 'report.json']) log(`wrote data/hoboken/${f} (${Math.round(fs.statSync(OUT + f).size / 1024)} KB)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
