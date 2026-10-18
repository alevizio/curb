# Hoboken

Built 2026-10-18. Data build: `scripts/cities/hoboken.mjs` → `data/hoboken/` (format in [city-build.md](city-build.md));
tests: `scripts/cities/hoboken.test.mjs`.

## How the rule works

Hoboken calls it **alternate side parking**: all year, each side of a street has one posted hour a week when parking
is banned for street cleaning (for example Bloomfield St, east side Monday 11 a.m. to noon, west side Tuesday). Washington
St is swept every weekday morning: 8 to 9 on one side and 9 to 10 on the other, by stretch.

- **Fine:** $50, Hoboken Code § 190-44A ("§ 190-28 Alternate side street parking", schedule amended 4-22-2026).
- **Tow:** § 190-44B lets the City tow under a section that allows it or where a "Tow Away Zone" sign is posted;
  § 190-28 does not allow it by itself. So: towing only where a tow away sign is posted (`tow: sometimes`).
- **Holidays:** "The City suspends street cleaning (alternate side parking) rules on government holidays"; the City's
  list has 15 days in 2026, Election Day and a Floating Holiday (December 24) among them. Every one that falls on a
  weekday matters, since Hoboken sweeps Monday to Friday. Street cleaning "may also be suspended during severe weather",
  announced on Nixle and social media (not modeled). `holidayRule: all`.
- No season: all year (`months` 0).

## The data

| Source | What it gives | Notes |
|---|---|---|
| [Hoboken Code § 190-28](https://ecode360.com/15236904), Alternate parking locations | The schedule: street, side (North, South, East, West, Both), day and hour, and the stretch ("Newark Street to Sixteenth Street"). 118 rows in force | The law, amended through 2021. The City's schedule page sends residents to it "for the most current alternate side parking regulations". ecode360 blocks scripts (a browser check), so the rows are transcribed in the build (`CODE_ROWS`, read 2026-10-18) |
| [Hoboken Streets](https://services8.arcgis.com/LDmC4ZVHdfKcEzxl/arcgis/rest/services/Hoboken_Streets/FeatureServer/0) (City GIS) | 523 block lines (TIGER based), 458 with an older copy of the schedule per side (`STREETCLEANINGN/S/E/W`) | Last edited 2019-12-03. Lines, cross streets and block ids come from here. No license stated |
| [Street Cleaning Schedule](https://www.hobokennj.gov/resources/street-cleaning-schedule) (City page) | The same list as a table, 121 rows | Compared only. Its "Street Cleaning Schedule" button links to an unrelated site (njaggregation.us) |

## How it was placed

- Each Code row's stretch is found on the layer's street: its two limits are where the cross streets meet it, or the
  street's end ("north boundary"). Where a cross street does not reach the street in the layer, it is placed where its
  line crosses the street's line (Harrison St at 5th St, Paterson Ave at Monroe St, Sinatra Dr at 11th St) or at its
  nearest point (Castle Point Ter at 10th St, 15th St at Sinatra Dr, River Terrace at 7th St). There is no 17th St in
  the layer, so Clinton St runs to its north end. Every case is in `report.json` (`codeRows.notes`).
- The side named in the Code (North, East…) goes on the segment side that faces that way, from the line's drawn
  direction; "Both" gets both sides. Side labels are the Code's four words.
- Names: the Code's **Henderson St** is the layer's Marin Blvd (Jersey City's name for it), and its **River Terrace** is
  the layer's River St north of 5th St; both are shown with the Code's names. One unnamed segment (FID 524) is Jefferson
  St between 12th and 13th St, by its ends.
- Rule: `[weekday, from, to, 31, 0, 0]`, every week, all year, stopped by City holidays.
- Block id `c` is the layer's FID: unchanged since 2019, and the build warns if the layer is ever edited.
- Set aside: one Code row. Washington St west side "Between Newark Street and Seventh Street", 9 to 10 a.m. (1998,
  amended 2015), overlaps the 2015 row "Southerly curbline of Eight Street to the southerly boundary", 8 to 9 a.m., on
  the same side; the City's page and the layer both give 8 to 9 there.

Result: 464 blocks, 916 sides, 1,046 rules, 82 KB.

### The Code against the layer

925 block sides compared: 878 the same, 18 different, 20 only in the Code, 9 only in the layer. Most differences are
Code amendments newer than the layer's copy:

| Where | Code (shown) | Layer (2019) | Why |
|---|---|---|---|
| Washington St, 7th to 8th St, east side | 9 to 10 AM weekdays | 8 to 9 AM | Ord. B-105, 2019 |
| 9th St, Jackson St to Willow Ave, both sides | North Friday, South Wednesday, 3 to 4 PM | the reverse | Ord. B-371, 2021 |
| Sinatra Dr, Newark St to 4th St | West side Monday 10 to 11 AM | East side | Ord. B-292, 2020 |
| Sinatra Dr, north of 4th St, west side | none | Wednesday 8 to 9 AM | Ord. B-292, 2020 |
| 14th St to Sinatra Dr N, 12th St to Sinatra Dr N | extended east | ended at Hudson St | Ord. B-308, 2020; B-399, 2021 |
| 15th St east of Park Ave, north side | Wednesday 3 to 4 PM | none | Ord. B-308, 2020 |
| 6th St east of River Terrace, north side | none | Wednesday 11 AM to noon | Ord. Z-504, 2017 |
| Harrison St north of 6th St, east side | Monday 3 to 4 PM | none | Ord. Z-67, 2010 |
| 2nd St, Harrison St to Marshall St, south side; 9th St east end; Newark St, Grove St to Monroe St, north side | as the Code's stretch reads | none | layer gaps |
| Newark St, Garden St to Park Ave, north side | Friday 11 AM to noon | Friday 8 to 9 AM | one block, layer only |
| Grand St, 10th to 11th St | two rules per side (the Grand St rows and the 2002 block rows) | the 2002 rows only | see Gaps |

### The Code against the City's page

The page is an older copy: 7 rows predate amendments (14th St, 12th St, 6th St, Sinatra Dr, 15th St), it still lists
Vezzetti Way (repealed 2016), and it has Marshall St as west Thursday and east Monday (the Code and the layer: both sides
Thursday). On 8th St east of Willow Ave it swaps the sides (page: north Wednesday, south Friday; the Code and the layer:
south Wednesday, north Friday). Washington St's rows say the same as the Code in other words.

## Gaps

1. **Grand St, 10th to 11th St:** the Code's Grand St rows (16th St to Newark St, east Thursday 1 to 2, west Friday 1 to
   2) and its 2002 rows for this block (east Thursday 2 to 3, west Wednesday 2 to 3) both cover it; the layer has only
   the 2002 ones. CURB shows both until the City says which is posted.
2. **Washington St, west side, Newark St to 7th St:** the Code has two rows for the same side (9 to 10 and 8 to 9); 8 to
   9 is used (page and layer agree). The Code also marks four Washington St rows with an asterisk that has no note.
3. **Tow away zones** are not in any data: every rule is ticket only, and the page says towing happens only where
   posted.
4. **Storm suspensions** are announced the same day (Nixle, social media); CURB cannot know them.
5. **2027 holidays** are derived from 2026 by the same rule; the 2027 Floating Holiday is unknown and left out.
6. **No citations** with time and place are published.

## Questions for the City

To the Parking Utility (parking@hobokennj.gov):

1. Which Grand St windows are posted between 10th and 11th St?
2. Washington St west side between Newark St and 7th St: 8 to 9 or 9 to 10? Should the 1998 row be repealed? What does
   the asterisk on the Washington St rows mean?
3. Could the Hoboken Streets layer get the 2017 to 2021 amendments, and the schedule page too (8th St east of Willow is
   swapped there, Vezzetti Way is gone)?
4. Which blocks are tow away zones during street cleaning?
5. The 2027 holiday list, including the Floating Holiday.
6. A machine readable notice when street cleaning is suspended for weather.

## What the page needs that the format does not cover

- A **per rule tow flag** is in the format (flags 2) but Hoboken publishes no tow zones; `tow: sometimes` covers it in
  words only.
- **Same day suspensions** (weather): a feed or a manual switch per city, if CURB ever wants to say "suspended today".
