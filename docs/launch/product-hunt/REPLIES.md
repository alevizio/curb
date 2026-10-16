# Launch day: likely questions and the facts behind each

Facts only, so you can answer in your own words (Product Hunt hides comments that read as AI written).
Every number here was checked against the live site on Oct 2 and 3, 2026.

**Will it come to my city?**
San Francisco only. Boston and Buenos Aires are researched, nothing shipped, no promises. What a city
needs: street sweeping or parking rules tied to street blocks, ideally citations with time and place.
Ask them which city and whether it publishes citation data.

**Android?**
No Android app. The web app works in Android Chrome, including push alerts (no install needed).
On iPhone, push alerts need the free app or adding curb.guide to the Home Screen; calendar reminders
work everywhere.

**Where does the data come from?**
Sweep schedules, permit areas and meters: DataSF, the city's open data (schedules are fetched live).
Ticket times: about a million GPS-located street-cleaning citations from an SFMTA public records request
(#26-5453, 2024 to mid 2026), about 815,000 of them matched to their blocks. Sweeper passes: SF Public
Works sweeper GPS from a second records request (#26-5451).

**How accurate are the ticket times? Is it live?**
Historical, not live. They show when tickets usually landed on that block in 2024 to mid 2026. About 85%
of swept blocks have enough tickets to show a time (10,462 of 12,253). Schedules are live; there is no
live sweeper feed in SF. The posted sign always wins.

**The 2 hours vs 20 minutes claim**
About 77% of tickets are written in the first 45 minutes of the posted window, about 90% in the first
hour. A typical block's tickets land in about 15 minutes, about 25 minutes into the window. Where we have
the sweeper's GPS, the ticket comes a median of about 19 minutes after the sweeper passes.
Example: the 200 block of Steiner St, posted 9 to 11am: 278 tickets, earliest 9:00am, median 9:12am,
90% by 9:21am.

**Privacy**
No account, no ads, no cookies. If you turn on alerts, it stores an anonymous push subscription with the
block you picked. Cookieless, aggregate analytics. Anonymous error reports, no IP stored.

**Alerts**
Pick Light (30 minutes before), Normal (also the night before) or Intense (also the morning of), and a
voice (Cheeky, Drill, Deadpan). Overnight sweeps get one "move it tonight" push instead. You can still
arm the next sweep while your block is being swept.

**Is the city OK with this?**
SFGate (24 Jun 2026): "the agency hasn't taken issue with this use of city data." Quote it, don't
paraphrase it as "approved".

**Business model? Open source?**
Free, no ads, no paid tier. MIT licensed, github.com/alevizio/curb. Running costs are about $300 a year.

**How was it built?**
Solo, by you, since June 8, 2026. The press page says AI (Claude) helped with the data analysis and the
backend, so say the same if asked.

**Fine and holidays**
The street-cleaning fine is $105 in 2026. CURB flags city holidays: Monday Oct 12 (Indigenous Peoples
Day), daytime sweeping is not enforced.

**Neighborhoods**
Most-ticketed over the last two years: Mission (about 109,000 tickets, $11.1M), then Tenderloin and
Sunset/Parkside (about 63,000 each), Pacific Heights and Outer Richmond (about 50,000 each).

**Things not to say**
"No data collection", "real time", "every ticket", "complete record", other cities as available.
