# Building a city's data

How each new city's data is built, for the generic city page (`scripts/cities/city-page.mjs`, `lib/city.js`).
Boston was built by hand first (`scripts/cities/boston.mjs`, `boston-page.mjs`); every city after it follows this
file. The reasons are in [README.md](README.md), the checklist in [adding-a-city.md](adding-a-city.md).

## What a city's build writes

| File | What it is |
|---|---|
| `scripts/cities/<id>.mjs` | The build script. Fetches the City's open data (raw downloads cached in `private/cache/<id>/`, which is gitignored), converts it, writes the three data files below. Re-runnable; `--refresh` fetches again. Fails loudly when the City's data changes shape. |
| `scripts/cities/<id>.test.mjs` | Vitest tests for the parsing and decoding, with real rows from the City's data and the expected rules. |
| `data/<id>/segments.json` | Every block side with an enforced rule, in the format below. |
| `data/<id>/city.json` | The city's facts: time zone, holidays, map view, fine, sources, words. |
| `data/<id>/report.json` | Counts, what was skipped and why, and any cross-check against the City's tickets. |
| `docs/multi-city/<id>.md` | A short research page: how the rule works, the data, the gaps, questions for the City. No names of people. |

`<id>` is lowercase with dashes: `oakland`, `santa-monica`, `new-york`, `washington-dc`.

## segments.json

The same format as `data/boston/segments.json`, so the page reads every city the same way:

```
{ "_meta": { "generated": "<ISO date>", "sources": [...], "format": "<one line>" },
  "b": [ { "c": "<block id>", "s": "<street>", "l": "<from street> - <to street>",
           "h": "<neighborhood>", "n": [<lowest>, <highest house number>], "o": "L" | "R",
           "g": [[lng, lat], ...],
           "d": [ ["L" | "R", "<side label>", [ <rule>, ... ]], ... ] } ] }
```

- `c`: the City's own id for the block or segment, stable between data refreshes (saved alerts depend on it). String.
- `s`: the street as people say it ("Telegraph Ave", "W 9th St"). `l`: the two cross streets joined by ` - `.
- `h`, `n`, `o` are optional. `o` is the side with the odd house numbers, when the data says.
- `g`: the street centerline of that block, first point to last, coordinates to 6 decimals. **L and R are the
  left and right side looking from the first point to the last.** Get this right: the map draws each side's
  line on that side of the street.
- Side label: what the sign or the City calls that side. Compass ("North", "Southeast": see `compass()` in
  `scripts/cities/boston.mjs`) or "Odd side" / "Even side".
- Only rules that get a ticket or a tow. Leave out voluntary or unposted sweeping, and say how much in the report.

A **rule** is one of:

```
[ dow, from, to, weeks, months, flags ]           a weekly or monthly rule
[ -1,  from, to, 0,     0,      flags, [dates] ]  a rule on listed dates
```

- `dow`: JavaScript weekday, 0 = Sunday to 6 = Saturday.
- `from`, `to`: the window in the city's local time, hours 0 to 24. Whole hours as numbers (`8`, `12`); a
  window with minutes as a `"H:MM"` string (`"9:30"`). A window that crosses midnight has `to` smaller than `from`.
  Overnight windows that start at 12:01 AM use `0`.
- `weeks`: which occurrences of that weekday in the month, bit 0 = the 1st, bit 4 = the 5th. Every week = 31.
  "1st and 3rd" = 5. "2nd and 4th" = 10.
- `months`: the season, bit 0 = January to bit 11 = December. 0 = all year. April to November = 2040.
- `flags`: 1 = not suspended on holidays (an overnight program that runs anyway), 2 = towable.
- `dates`: local dates `"YYYY-MM-DD"`, for cities that publish dates instead of a pattern (Chicago, Saint Paul,
  Norfolk). List every date the build knows, at least through the end of the current season.

Keep `segments.json` under about 6 MB. If a city is bigger, say so in the report; don't drop data to fit.

## city.json

```
{ "id": "oakland", "name": "Oakland", "region": "California", "tz": "America/Los_Angeles",
  "center": [lat, lng], "zoom": 14, "bounds": [[south, west], [north, east]],
  "holidays": { "2026-01-01": "New Year's Day", ... },      2026 and 2027, the City's own list
  "holidaysSource": "<url>", "holidayRule": "all" | "daytime",
  "fine": "$72", "tow": "no" | "yes" | "sometimes", "fineSource": "<url>",
  "agency": "Oakland Public Works", "scheduleUrl": "<the City's own sweeping page>",
  "sources": [ { "name": "...", "url": "...", "license": "...", "fetched": "<date>" } ],
  "words": { "rule": "<one sentence a resident would recognize>",
             "afterpass": "<the sheet's one line under the schedule: season, fine, tow>",
             "dataNotes": "<two or three sentences: where the schedule comes from and how it was placed>" },
  "neighborhoods": [ { "name": "...", "bbox": "w,s,e,n" } ]   optional, for the welcome card
}
```

- `holidayRule`: `all` when a holiday cancels every sweep that day, `daytime` when overnight sweeps still run
  (Boston). A City that moves a sweep to a make-up day: say so in `words.afterpass` and the report.
- `bounds` frames the City's streets, `center` and `zoom` the opening view (zoom 14 or 15, the busiest area).

## report.json

Counts in and out (rows, segments, blocks, sides, rules), what was skipped with a reason and a few examples,
the season, and a cross-check whenever the City publishes tickets with time and place: of last year's street
cleaning tickets, how many land on a block side the data says is swept that day and hour. That number is how
we know an old schedule is still the one on the signs.

## Rules for the build

- Use only the City's published data and the City's own pages. Note every assumption and anything unverified.
- Never copy people's names, phone numbers, plates or addresses tied to a person into any file.
- Only touch your city's files (the table above). Shared files (`lib/`, `index.html`, other cities,
  `package.json`, `vercel.json`) change in one place, by the project owner: say what you need instead.
