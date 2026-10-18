# Montréal

Data built 2026-10-18 (`scripts/cities/montreal.mjs` → `data/montreal/`), following [city-build.md](city-build.md).
No page yet. Every number below is in `data/montreal/report.json`. Snow removal (Planif-Neige, which needs a token
by email) is out of scope.

## How the rule works

- **Each side of a street has its own posted cleaning time.** A street cleaning sign reads like
  `\P 13h-14h MAR. 1 AVRIL AU 1 DEC.` (573 panels): no parking (`\P`) 1 to 2 PM on Tuesdays, April 1 to December 1. Most
  windows are one to three hours, one day a week (17,781 of 20,873 sides have one rule); busy streets have Monday to
  Friday windows, a few downtown streets one every day (5 to 7 AM), some windows run past midnight (11:30 PM to
  12:30 AM). The signs are the rule: "The parking restrictions must be observed for the entire period indicated on the
  signage, regardless of the weather" ([montreal.ca](https://montreal.ca/en/how-to/find-out-when-parking-prohibited-street-maintenance),
  updated November 27, 2025).
- **The season depends on the borough** (same page): April 1 to December 1 in 12 boroughs, March 15 to November 15
  (Lachine), April 16 to November 15 (LaSalle), April 1 to November 30 (Outremont), April 1 to November 14 (Verdun),
  March 1 to December 1 or April 15 to November 15 depending on the sector (Saint-Laurent), and none in
  Pierrefonds-Roxboro and L'Île-Bizard–Sainte-Geneviève. The signs carry their own dates; the build uses those.
- **Holidays do not stop it.** "Attention aux périodes d'interdiction : elles sont aussi valables les jours fériés"
  ([montreal.ca, Stationnement dans la rue](https://montreal.ca/sujets/stationnement-dans-la-rue), updated December
  16, 2025). Every rule carries flag 1 (runs on holidays); `city.json` lists Québec's statutory holidays for 2026 and
  2027 anyway, with `holidayRule: all`, and they change nothing.
- **Fine: not found on montreal.ca.** Its ticket pages explain how to pay but give no amounts. Press reports of the
  City's 2025 budget put an illegal parking ticket at $65 plus court fees (unverified), so `city.json` leaves `fine`
  empty. **Tow: sometimes.** No City page says. The tow log (below) shows slightly more tows inside cleaning windows
  than chance: towing for street cleaning happens, rarely.
- **Outremont** posts its cleaning as no stopping (`\A`) on some commercial streets, with the same season (176 panels,
  code family OUT-ADN next to OUT-SDN for `\P`). Read as street cleaning; no City page says so.

## The data

| Need | Source | Notes |
|---|---|---|
| Rules | [Signalisation (stationnement sur rue)](https://donnees.montreal.ca/dataset/stationnement-sur-rue-signalisation-courant) (CC BY 4.0) | Daily. 144,771 panels: 118,399 in place ("Réel"), 12,311 removed, 8,319 planned, 5,742 archived. Pole id, panel text (`DESCRIPTION_RPA`), code, arrow (`FLECHE_PAN`), pole coordinates, borough. The City warns that some boroughs are incomplete and that the data may not match the street everywhere |
| Sign codes | Codification RPA (same page) | 3,982 codes, last updated 2020. Used as a second reading of each sign (below) |
| Street sides | [Géobase double](https://donnees.montreal.ca/dataset/geobase-double) (CC BY 4.0) | Weekly. 91,606 side lines (72,254 in Montréal), `COTE_RUE_ID`, `COTE` Droite or Gauche of the centerline `ID_TRC` |
| Blocks | [Géobase, réseau routier](https://donnees.montreal.ca/dataset/geobase) (CC BY 4.0) | Weekly. 48,031 centerlines digitized the way house numbers grow, with street names, house numbers per side, borough per side |
| Check | [Remorquages de véhicules gênants](https://donnees.montreal.ca/dataset/remorquages-de-vehicules-genants) (CC BY 4.0) | Tows with date, time and place, no side; 21,732 in the cleaning seasons of 2025 and 2026, read with the portal's SQL API |

## How it was built

1. **Decoding the signs** (`decodeRpa`, 87 tests on real panel texts in `montreal.test.mjs`). A panel is street
   cleaning when it bans parking (`\P`) or stopping (`\A`) during hours, with a season starting in March or April and
   ending in November or on December 1, and no exception. 439 distinct texts, 43,495 panels in place, all decoded,
   none guessed: spellings like `1AVRIL AU 1DEC`, `1ER AVRIL - 30 NOV`, `9H @ 12H`, `1er mars - 1er déc`, `MAR.`,
   `LUN A VEN`, `MER ET VEN`, and typos (`LUNDRI`, `1 AVIL`, `1 AVRILS`, `JEUDI15 MARS`). A sign with no day applies every
   day. Left out on purpose, with a cleaning season: 59 exceptions (`\P EXCEPTE 8h - 12h MERCREDI …` means parking is
   allowed only then, while the other side is cleaned; others reserve the curb for motorcycles or City vehicles), 36
   all day bans for the whole season (no window), and 2 Anjou panels without `\P` ("Stationnement réservé véhicule de
   promenade, VEN, 8h-12h, …").
2. **Two readings of each sign.** The same sign in the 2020 code table decodes to the same rules for 42,737 panels;
   200 differ, all in Lachine, where the table still says April 1 and sometimes other hours or days: the panel text is
   newer and wins. 527 panels use codes newer than the table. The days also match the code family (SU one day, SB two, ST three, SV Monday to Friday, SD every day)
   on 41,905 panels; 19 differ, read from the text.
3. **Placing the poles.** Each pole goes on the nearest Montréal side line within 15 m that is on the pole's side of
   its own centerline (the pole stands on the curb). 43,210 of 43,234 poles placed; distance to the side line: median
   2.9 m, 99% within 6.7 m. Unplaced: 18 in Montréal-Est (another city, blank borough in the data) and 6 with no street
   within 15 m. Where another side line is less than 2 m farther (1,560 poles, at corners and where one block meets
   the next), the pole goes to the side where other poles post the same rules (962), else the nearest. A pole with two
   different panels can hold one for each of two streets: 22 such panels went to the nearby side whose other poles post
   them. Arrows were not used to place anything: 96% of cleaning panels have none (the whole side). Read facing the sign
   from the street, arrow 2 is "left" for 786 of 1,053 arrowed panels near a block end, and "right" for 267.
4. **Sides and blocks.** One block per Géobase segment (`c` = `ID_TRC`, stable), its line in the Géobase's direction,
   `L`/`R` from the double's Gauche/Droite (true for all 91,592 side lines checked against their centerline). Street
   names as Montréal writes them ("rue Saint-Denis", "avenue du Mont-Royal Est", "6e Avenue"), boroughs as montreal.ca
   writes them. Cross streets from the Géobase's junctions; where it splits a street without a crossing, the search goes
   on along the same street (1,263 ends); an end at one of the Géobase's unnamed ways ("voie Non-nommée", 319 ends) is
   not named, so the other cross street shows alone. Result: **12,930 blocks, 20,873 sides, 25,943 rules, 4.3 MB**
   (6 decimals, no simplification).
5. **Side labels follow the street grid's directions, not true north.** Montréal's grid is turned: its "north" (up
   boulevard Saint-Laurent, toward the north end of the island) points 57° west of true north, and locals and addresses
   use those directions. So each label is the side's direction, from the block line's first point to its last, turned
   clockwise by 57°, then named with the eight compass words: the side of rue Sherbrooke Est toward the mountain is
   "North", the sides of boulevard Saint-Laurent are "East" and "West", and a street running close to true north, like
   boulevard Monk, has "Northwest" and "Southeast" sides. 57° is measured on the block lines: the length-weighted peak
   of all segment bearings, mod 90, is 32.5° (grid east), and boulevard Saint-Laurent's blocks have a median bearing of
   -57.3°. Parts of the east end run on a second grid about 10° off (rue Sherbrooke Est, rue Ontario Est) and keep the
   same words. Labels: West 5,217, East 5,212, North 4,016, South 3,975, and 2,453 diagonal (12%). A 57° turn moves
   every label one or two compass steps from its true north name (`report.json` `labels`).
6. **When the poles of a side disagree, every rule is kept.** 9,771 sides have one pole, 10,628 several that agree,
   474 several that do not: on 149 one pole posts the others' rules and more (often a short stretch near a corner with
   its own time, like the end of 2e Avenue next to rue Masson), on 325 they differ. On 446 of the 474 every rule set but
   the commonest is on a single pole. The side shows all of them, so a driver sees the stricter picture.
7. **The season as months.** A month counts when the sign's dates cover more than half of it, which is the same as
   moving each date to the nearest first of a month. April 1 to December 1 → April to November (41,903 panels); April 1
   to November 30 → April to November (978); March 1 to December 1 → March to November (363); March 15 to November 15 →
   March to October (223); April 15 to November 15 → April to October (28). Not shown though on the sign: December 1
   (a Tuesday in 2026) and November 1 to 15 where signs end November 15. Shown though not on the sign: March 1 to 14
   where signs start March 15, April 1 to 14 where they start April 15. `words.afterpass` says so. If those days matter,
   each rule could get a second rule listing the dates.

## What the checks say

- **Format:** every block has `c`, `s`, `l`, `h`, `g` (2+ points, 6 decimals) and `d` (1 or 2 sides, rules valid).
- **Sides:** all 43,232 pole and side pairs are on their side of the written line; independently, the City's own side
  line for every one of the 20,873 sides lies on the side `segments.json` names. Five blocks are written out by hand in
  `report.json` `validation.spotChecks` (avenue Adhémar-Mailhiot, rue Champdoré, rue Bélanger, rue Angus, avenue
  Argyle): each pole's coordinates against the first and last point.
- **Labels:** in grid directions, the compass word matches the direction from the street line to the pole for 40,291
  pairs, one step off for 2,234 (bends, corners), more for 707.
- **Tows:** of 13,813 tows on cleaned blocks in the cleaning seasons, 611 (4.4%) fall inside a cleaning window of that
  block, against 3.8% for the same tows moved to other days of the week. The log is mostly tows for work and events, so
  it neither confirms nor contradicts the schedule, and it says towing for street cleaning is rare. Montréal publishes
  no ticket data with time and place, so there is no ticket check.

## Gaps

- **Coverage.** The inventory is thin in Lachine (97 blocks), Saint-Laurent (139), Montréal-Nord (140) and
  Saint-Léonard (3), and nearly empty in LaSalle (4 cleaning panels, all on avenue Irwin, which the Géobase puts in Le Sud-Ouest) and Verdun (none), though all
  six post street cleaning.
  The map will look empty there.
- **One-pole sides:** 9,771 sides rest on one pole; 4,987 blocks have one cleaned side (the other may be no parking at
  all times, or unsigned in the inventory).
- **Sub-block zones:** where a side changes time partway (arrows on the same pole), the side shows both times.
- **The season edges** above (December 1, November 1 to 15, March 1 to 14, April 1 to 14).
- **Fine** unknown from the City; **tow** inferred from the tow log.

## Open calls for the project owner

1. **French.** The words in `city.json` are English, as asked; the signs and street names are French. A French page
   is a separate decision.
2. **Season edges:** months as asked, or add listed date rules for the days the months miss or add.

## Questions for the City (donneesouvertes@montreal.ca)

1. Are the street cleaning signs of LaSalle, Verdun, Saint-Léonard, Montréal-Nord, Lachine and Saint-Laurent in the
   sign inventory, or kept elsewhere? The dataset notes some boroughs are incomplete.
2. What do the `FLECHE_PAN` codes mean (0, 2, 3, 8, and the rare 1, 4, 5, 10, 11, 22), seen from where?
3. Does `PAS_SUR_RUE = 1` mean the pole is not on the street (183 cleaning poles flagged were within 15 m of a street
   side and placed)?
4. On Outremont's commercial streets, are the `\A` (no stopping) windows from April 1 to November 30 street cleaning?
5. `\P EXCEPTE 8h - 12h MERCREDI 1er AVRIL - 30 NOV` (Outremont) and the Lachine `\P EXCEPTÉ …` signs: is parking
   allowed only during those hours (while the other side is cleaned)?
6. The parking fine for a street cleaning ban, and whether cars are towed during street cleaning.
7. The code table (Codification RPA) dates from 2020 and differs from the panels in Lachine: can it be refreshed?
8. Montréal-Est panels appear in the dataset with no borough (18 cleaning panels): are they meant to be there?
