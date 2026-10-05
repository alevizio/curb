# The city data format

Every city publishes its curb rules differently. CURB reads one format. A city's build script
(`scripts/cities/<id>.mjs`) converts whatever the city has into this format and commits the result.

This is version 1, written 2026-10-01. Nothing reads it yet: SF still reads its DataSF rows directly.
The second city is the first user, and the format should be corrected against that city's real data
before it is treated as fixed.

## The idea

A street block is a line. A line has a left and a right side. Each side has rules. A rule says what is
not allowed (or what it costs), and when.

Street sweeping is one kind of rule. So is "no parking 7 to 21 on weekdays", a meter, or a permit area.
San Francisco and Boston are mostly sweeping rules. Buenos Aires has no sweeping rules at all.

A side with no rule that restricts parking is free. A side whose rule never changes (never allowed) has
no "next" time. A side with a window that comes back every week (a sweep, a weekday ban, paid hours) is
what CURB counts down to and alerts on, whatever its type.

The names follow the Open Mobility Foundation's
[Curb Data Specification](https://github.com/openmobilityfoundation/curb-data-specification) (CDS) 1.1.0
wherever CDS has the same idea, so a city that already serves a CDS Curbs API (Boston is building one)
converts almost one to one. CDS 1.1.0 added `weeks_of_month` to time spans for exactly this use, street
cleaning. CURB's format is smaller than CDS: no UUIDs, no curb spaces, no rates by duration.

## The file

`data/<city>/segments.json`

```json
{
  "city": "boston",
  "time_zone": "America/New_York",
  "generated": "2026-10-01T00:00:00Z",
  "sources": [
    { "name": "Street Sweeping Schedules", "url": "https://data.boston.gov/dataset/street-sweeping-schedules",
      "license": "ODC PDDL", "fetched": "2026-10-01" }
  ],
  "segments": [ ]
}
```

### Segment

One street block, between two cross streets.

| Field | Required | Meaning |
|---|---|---|
| `id` | Yes | A string, unique inside the city, and the same block keeps the same id across data refreshes. Alerts and links are keyed on it. Use the city's own segment id when it has one |
| `street` | Yes | Street name as people say it: "Valencia St" |
| `from`, `to` | No | Cross streets at each end |
| `line` | Yes, unless every side has its own | The centerline, `[[lng, lat], …]`. Its drawing direction defines left and right |
| `hood` | No | Neighborhood name |
| `sides` | Yes | One or two sides |

### Side

| Field | Required | Meaning |
|---|---|---|
| `side` | Yes | `"L"` or `"R"`, looking along the line's drawing direction. `"B"` when a rule covers both and the city does not split them |
| `label` | Yes | What the city calls this side: "West", "Even", "Vereda par" |
| `numbers` | No | House number range on this side, `[low, high]` |
| `line` | No | The curb line itself, when the city publishes one per side (Buenos Aires does). The map then draws it as is, and the segment's own `line` becomes optional |
| `rules` | Yes | The rules. An empty list means "nothing known", never "free parking" |

### Rule

| Field | Required | Meaning |
|---|---|---|
| `type` | Yes | One of the types below |
| `time_spans` | Yes | When it applies. Several spans are joined with "or". An empty span, `{}`, means always |
| `holidays` | No | `"suspended"` (does not apply on city holidays), `"applies"` (applies anyway), or absent when unknown |
| `tow` | No | `true` when the car can be towed, not only ticketed |
| `fine` | No | The fine, in the city's currency |
| `max_stay` | No | Minutes, for metered and time limited rules |
| `rate` | No | Price per hour, for metered rules |
| `permit` | No | Permit area name, for permit rules |
| `note` | No | Short text from the sign that does not fit elsewhere |
| `source_id` | No | The row id in the city's own dataset, to trace a rule back |

### Rule types

| `type` | What it means for a driver | Closest CDS rule |
|---|---|---|
| `sweeping` | Move the car during the window. Street cleaning | activity `no parking`, with a name |
| `no_parking` | No parking during the window (rush hours, avenues by day) | activity `no parking` |
| `no_stopping` | No stopping at all during the window | activity `no stopping` |
| `metered` | Paid parking during the window | activity `parking` with a `rate` |
| `time_limit` | Free, but for a limited time | activity `parking` with `max_stay` |
| `permit` | Permit holders only, or a time limit for everyone else | activity `parking` with `user_classes` |
| `loading` | Loading only during the window | activity `loading` |

Add a type only when a city needs it and the map knows how to draw it.

### Time span

The CDS time span, minus the parts CURB does not use.

| Field | Meaning |
|---|---|
| `days_of_week` | `["mon", "tue", …]`. Absent means every day |
| `weeks_of_month` | `[1, 3]` means the 1st and 3rd time that weekday falls in the month. Absent means every week |
| `months` | `[4, 5, …, 11]` for a season. Absent means all year |
| `time_of_day_start`, `time_of_day_end` | `"HH:MM"`, 24 hour, the city's local time. Start is included, end is not. An end that is not later than the start means the window runs past midnight |

Holidays are not part of a time span. They are a list per city (dates and names), and each rule says
whether it is suspended on them.

## Examples

**San Francisco.** Valencia St between 19th St and Cunningham Pl. DataSF gives one row per weekday; the
two West side rows (Wednesday and Friday) become one rule with two days.

```json
{
  "id": "13065000", "street": "Valencia St", "from": "19th St", "to": "Cunningham Pl",
  "line": [[-122.42143, 37.7601], [-122.42136, 37.75937]],
  "sides": [
    { "side": "R", "label": "West", "rules": [
      { "type": "sweeping", "holidays": "suspended", "fine": 105,
        "time_spans": [{ "days_of_week": ["wed", "fri"], "time_of_day_start": "06:00", "time_of_day_end": "08:00" }] } ] },
    { "side": "L", "label": "East", "rules": [
      { "type": "sweeping", "holidays": "suspended", "fine": 105,
        "time_spans": [{ "days_of_week": ["tue", "thu"], "time_of_day_start": "06:00", "time_of_day_end": "08:00" }] } ] }
  ]
}
```

**Boston.** Archdale Rd between South St and Washington St. Odd side on the 1st and 3rd Thursday, Even
side on the 2nd and 4th, noon to 4 PM, April to November.

```json
{
  "id": "158", "street": "Archdale Rd", "from": "South St", "to": "Washington St",
  "line": [[-71.1192, 42.29143], [-71.12011, 42.29203], [-71.12139, 42.29278], [-71.1229, 42.29362]],
  "sides": [
    { "side": "L", "label": "Odd", "numbers": [1, 105], "rules": [
      { "type": "sweeping", "holidays": "suspended", "tow": true, "fine": 40, "source_id": "196",
        "time_spans": [{ "days_of_week": ["thu"], "weeks_of_month": [1, 3], "months": [4, 5, 6, 7, 8, 9, 10, 11],
                         "time_of_day_start": "12:00", "time_of_day_end": "16:00" }] } ] },
    { "side": "R", "label": "Even", "numbers": [2, 104], "rules": [
      { "type": "sweeping", "holidays": "suspended", "tow": true, "fine": 40, "source_id": "498",
        "time_spans": [{ "days_of_week": ["thu"], "weeks_of_month": [2, 4], "months": [4, 5, 6, 7, 8, 9, 10, 11],
                         "time_of_day_start": "12:00", "time_of_day_end": "16:00" }] } ] }
  ]
}
```

**Buenos Aires.** Av. Santa Fe 3201 to 3260, with one curb line per side as the City publishes it. The
right side is never allowed; the left side is closed on business days from 7:00 to 21:00. The full
example and the list of that city's rule values are in [buenos-aires.md](buenos-aires.md).

## Phase 1 shortcut: today's row

The page, the block sheet, the alert sender and the block pages all read one row shape today, the DataSF
sweeping row. For the second city the build script can write that same row shape, so none of that code
changes, and the full format above only becomes necessary when a city has rules that are not sweeping.

| Row field | Meaning | From the format above |
|---|---|---|
| `cnn` | Block id | segment `id` |
| `corridor` | Street name | `street` |
| `limits` | "19th St - Cunningham Pl" | `from` + `to` |
| `blockside` | Side label | side `label` |
| `cnnrightleft` | `L` or `R` | side `side` |
| `weekday` | One weekday per row, or `Holiday`: the side's posted holiday schedule, which sweeps on minor holidays only (SF, `makeTimeCore`'s `holidaySchedule`) | one row per entry of `days_of_week` |
| `fromhour`, `tohour` | Whole hours | `time_of_day_start`, `time_of_day_end` |
| `week1` … `week5` | `"1"` or `"0"` | `weeks_of_month` |
| `holidays` | DataSF's flag. SF no longer reads it: its street-cleaning tickets show every weekday row stops on holidays (2026-10-05) | `holidays: "applies"` |
| `months` | New and optional. A list of months in season | `months` |
| `line` | GeoJSON LineString | `line` |

Where the row is read: `index.html` (viewport fetch, `drawSegments`, `openSheet`), `lib/sweep-core.js`
(`nextSweep`, `holidaySkip`, `holidayNote`), `api/_spot.js` (`sanitizeRule`), `api/_schedule.js`, `api/_geo.js`,
`api/block.js`, `scripts/build-schedules.mjs`, `scripts/build-overview.mjs`.

## What the row cannot say yet

These are known and are the reason the fuller format exists.

1. **Minutes.** Hours are whole numbers. Boston has 301 rows starting at 00:01.
2. **Windows past midnight**, for example 22:00 to 06:00.
3. **Rule type.** Every row is assumed to be sweeping, in the colors, the sheet, the wording and the
   alert text.
4. **Tow or ticket**, and the fine, per rule.
5. **Rules that depend on something outside the calendar**: snow emergencies, game days, temporary signs.
   CDS calls these designated periods. CURB does not model them and says "the posted sign wins".
