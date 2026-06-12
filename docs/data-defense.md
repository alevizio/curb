# Why CURB is not "Find My Parking Cops" — the data defense

_Written pre-launch (June 2026). Have this ready before launch day; the question WILL
come up — on HN, on Reddit, and possibly from SFMTA. Find My Parking Cops (Sept 2025)
proved the demand (~1M impressions in 4 hours) and the risk (the city cut its data
source within 4 hours)._

## The one-paragraph answer

CURB uses the city's own published open data, in bulk, historically, under the license
the city attached to it. It shows when tickets have landed on a block over the past two
years — a statistical summary of public records. It does not track enforcement
officers, does not show live citation activity, does not predict where officers are
now, and cannot be used to evade an officer in real time. The posted sign is presented
as the source of truth on every surface.

## Point by point

| Find My Parking Cops (killed in 4 hrs) | CURB |
|---|---|
| Reverse-engineered sequential citation numbers from SFMTA's payment portal — an unintended access pattern | Reads published DataSF datasets (`ab4h-6ztd` citations, `yhqp-riqs` schedules) via the documented Socrata API |
| Near-real-time: officer locations "as of minutes ago" | Historical: two years of citations, aggregated per block; refreshed monthly at build time |
| Showed individual officers' positions and per-officer leaderboards | No officer data at all — no badge numbers, no names, no positions; only block-level time statistics |
| Purpose: dodge the officer driving toward you | Purpose: move your car before the legally posted window — i.e., comply with the rule |
| No license to the data | DataSF publishes these datasets under the Open Data Commons PDDL |

## Supporting facts

- The same citations dataset powers the SF Standard's and SF Chronicle's published
  analyses — CURB's use is journalistic-grade aggregation of the same public records.
- California Public Records Act + SF's Sunshine Ordinance make citation records public;
  DataSF's publication of them is the city's own decision.
- CURB arguably REDUCES violations: its alerts make people move before sweeping, which
  is the stated goal of the program (clean streets), not ticket evasion during active
  enforcement.
- Every surface (map sheet, about, tickets, README, llms.txt) repeats: the posted sign
  is the source of truth; times are historical guidance, never a guarantee.

## If SFMTA reaches out

Friendly posture, not defensive: CURB is open source, built on their published data,
credits DataSF everywhere, and we filed public-records requests asking them to publish
MORE (sweeper AVL, color-curb inventory — see records-request.md). Offer to talk.
The ask we'd make of them: publish the curb inventory and sweeper routes officially —
we'll consume the official feed the day it exists.
