# Adding a city

For someone who wants CURB in their city, and for whoever does the work. The plan and the reasons are in
[README.md](README.md); the data format is in [data-contract.md](data-contract.md).

A city does not need everything San Francisco has. It needs the first list below. The rest is optional
and can come later.

## 1. What we need to know first

Answer these before writing any code. One page is enough. [boston.md](boston.md) and
[buenos-aires.md](buenos-aires.md) are worked examples.

**How parking works there**

- What gets a parked car a ticket or a tow in this city? Street cleaning, no parking hours, the wrong
  side of the street, meters, permits. Which of those matter most to a resident?
- Are the rules posted on signs block by block, or does one rule cover the whole city unless a sign says
  otherwise?
- The time zone, whether there is a season (months when a rule is off), and which holidays suspend what.
- The fine, and whether the car is towed.
- Who writes the rules and who writes the tickets, with a link to the official page for each.

**What data exists**

For each dataset: the link, the license, how fresh it is, and whether it has geometry.

- Street lines, block by block, with a way to tell the two sides apart (left and right, odd and even,
  north and south). **This is the one thing a city cannot launch without.**
- The rules, each tied to a street block and a side, with days and hours.
- Optional: meters, permit areas, loading zones, neighborhood boundaries, citations with time and place.

**The questions that decide if it is possible**

1. Can every rule be attached to a street line and a side? If the rules have no geometry, how do they
   name a block (street plus cross streets, address range, segment id)?
2. Do block ids stay the same when the city updates the data? Alerts depend on it.
3. Is the license clear enough to republish the data on a free, public site?
4. Is there a rule that covers "everything else", and can it be stated in one sentence?

## 2. What the city gets at launch

Pick a level from the table in [README.md](README.md). Most cities should launch at level 2: the map,
the block sheet and alerts.

## 3. The work

1. **Research page**, `docs/multi-city/<city>.md`, from section 1.
2. **City entry** in `lib/cities.js`: id, name, URL path, time zone, map center and bounds, levels and
   layers that are on, fine, agency names, links.
3. **Data script**, `scripts/cities/<id>.mjs`. It fetches from the city's portal, converts to the shared
   format, and writes `data/<id>/`. It runs in the monthly data refresh. It must fail loudly when the
   city's data changes shape, with bounds in `scripts/validate-data.mjs`.
4. **Time rules.** A holiday list for the city with the rule it was derived from, a test that fails
   before the list runs out, and the season on each rule. Then
   `makeTimeCore({ tz, suspended, holidayName })` in `lib/sweep-core.js` does the rest.
5. **Tests**, next to the code: the city's time zone through its daylight saving changes, the season
   edges, the holiday list, and a few real blocks checked by hand against the posted signs or the city's
   own lookup tool.
6. **Words.** Every sentence that names the city, the agency or the fine. If the city does not read
   English, the whole interface and the alert texts, written by someone who lives there.
7. **Basemap** tiles for the city's bounds.
8. **Page and links**: `curb.guide/<city>`, its manifest, a line in the monitor.

## 4. Before it goes live

- A person in that city has checked at least 20 blocks on the map against the real signs, on different
  kinds of streets, and the misses are understood.
- The block sheet says where the data comes from and how old it is.
- An alert armed on a real block fired at the right local time, including across a daylight saving
  change in tests.
- The full test suite and the ship gate (`.github/workflows/verify.yml`) pass, and San Francisco is
  unchanged.

## What a city maintainer owns

The city's research page, its data script, its holiday list, and the facts in its wording. Design, the
shared code and what ships stay with the project owner. The ground rules in CONTRIBUTING.md apply: no
build step, free infrastructure only, no tracking, the posted sign wins.
