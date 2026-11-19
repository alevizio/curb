// Fixes to San Francisco's published street sweeping schedule (DataSF yhqp-riqs) for block sides where the City's own
// street cleaning tickets, and where we have one the posted sign, show the published rows are wrong. Every path that
// reads the schedule runs its rows through applySweepFixes: the map (index.html), the Parked alert (api/_park.js), the
// share image (api/og.js) and the baked files (scripts/build-schedules.mjs, build-overview.mjs, build-stats.mjs).
//
// A fix replaces one side's rows only while the City still publishes exactly the rows it was written against (`was`).
// Once the City changes that side, the City's rows win again and the fix goes quiet; staleSweepFixes lists those so
// they can be reviewed and removed. Fixed rows keep DataSF's own shape (strings, the side's line and cnnrightleft), so
// nothing downstream can tell them apart.
(function (root) {
  // Each schedule row is [weekday as DataSF spells it, from hour, to hour, weeks of the month as week1..week5 flags].
  const EVERY = '11111';
  const FIXES = [
    { cnn: '11834000', side: 'East', was: [['Wed', 12, 14, EVERY]], now: [['Thu', 8, 10, EVERY]],
      why: 'Shotwell St, 16th to 17th St. Posted sign "No parking 8 AM to 10 AM Thursday, street sweeping" (issue #66, '
        + 'photo 12-Nov-2026); 2026 tickets on the odd numbers every Thursday about 8 AM, none on a Wednesday.' },
    { cnn: '11833000', side: 'East', was: [['Wed', 12, 14, EVERY]], now: [['Mon', 8, 10, EVERY], ['Thu', 8, 10, EVERY]],
      why: 'Shotwell St, 15th to 16th St. Tickets on the odd numbers, Nov 2025 to Nov 2026: Mondays (75 on 32 dates) and '
        + 'Thursdays (46 on 30 dates), every week of the month, 8:04 to 8:26 AM; none on a Wednesday.' },
    { cnn: '11835000', side: 'East', was: [['Wed', 12, 14, EVERY]], now: [['Thu', 8, 10, EVERY]],
      why: 'Shotwell St, 17th to 18th St. Tickets on the odd numbers, Nov 2025 to Nov 2026: Thursdays (32 on 23 dates), '
        + 'every week of the month, about 8:13 AM; none on a Wednesday.' },
    // scan:start (written by scripts/sf-fixes-from-scan.mjs from the high confidence sides of scripts/scan-sf-ticket-days.mjs)
    { cnn: '12726000', side: 'North', was: [['Sat', 4, 6, '11111']], now: [['Tues', 8, 10, '11111']],
      why: 'Turk St, Gough St to Laguna St: City Sat 4-6; tickets Tues 8-10 (42 dates, 100% at 08:07-08:33) (scan 2025-11-19 to 2026-11-13, unlisted-day, wrong-day)' },
    { cnn: '9471000', side: 'South', was: [['Thu', 2, 6, '11111'], ['Tues', 2, 6, '11111'], ['Sat', 4, 6, '11111']], now: [['Tues', 2, 6, '11111'], ['Thu', 2, 6, '11111'], ['Sat', 2, 6, '11111']],
      why: 'Myrtle St, Larkin St to Polk St: City Thu 2-6, Tues 2-6, Sat 4-6; tickets Sat 2-6 (39 dates, 100% at 02:35-03:02) (scan 2025-11-19 to 2026-11-13, wrong-hours)' },
    { cnn: '3733000', side: 'NorthEast', lr: 'R', was: [], now: [['Mon', 9, 11, '11111']],
      why: 'Carroll Ave, Fitch St to Griffith St: City nothing; tickets Mon 9-11 (38 dates, 100% at 09:18-09:27) (scan 2025-11-19 to 2026-11-13, unlisted-day, side-not-listed)' },
    { cnn: '3737000', side: 'NorthEast', was: [['Fri', 4, 6, '11111']], now: [['Fri', 2, 4, '11111']],
      why: 'Carroll Ave, Jennings St to Keith St: City Fri 4-6; tickets Fri 2-4 (37 dates, 100% at 02:49-03:02) (scan 2025-11-19 to 2026-11-13, wrong-hours)' },
    { cnn: '7353000', side: 'North', lr: 'R', was: [], now: [['Thu', 9, 11, '11111']],
      why: 'Ivy St, Buchanan St to Webster St: City nothing; tickets Thu 9-11 (36 dates, 100% at 09:40-10:07) (scan 2025-11-19 to 2026-11-13, unlisted-day, side-not-listed)' },
    { cnn: '12569000', side: 'NorthEast', was: [['Fri', 4, 6, '11111']], now: [['Fri', 2, 4, '11111']],
      why: 'Thomas Ave, Griffith St to Hawes St: City Fri 4-6; tickets Fri 2-4 (36 dates, 100% at 03:00-03:14) (scan 2025-11-19 to 2026-11-13, wrong-hours)' },
    { cnn: '8388000', side: 'West', lr: 'R', was: [], now: [['Wed', 9, 11, '11111']],
      why: 'Linda St, 18th St to 19th St: City nothing; tickets Wed 9-11 (34 dates, 100% at 09:42-10:06) (scan 2025-11-19 to 2026-11-13, unlisted-day, side-not-listed, row-on-other-side)' },
    { cnn: '3733000', side: 'SouthWest', was: [['Sat', 7, 8, '11111'], ['Sun', 7, 8, '11111']], now: [['Fri', 9, 11, '11111']],
      why: 'Carroll Ave, Fitch St to Griffith St: City Sat 7-8, Sun 7-8; tickets Fri 9-11 (31 dates, 100% at 09:34-10:01) (scan 2025-11-19 to 2026-11-13, unlisted-day, wrong-day)' },
    { cnn: '12272000', side: 'North', was: [['Mon', 8, 11, '11111']], now: [['Wed', 8, 11, '11111']],
      why: 'Sunrise Way, Hahn St to End: 459-499 Block: City Mon 8-11; tickets Wed 8-11 (30 dates, 100% at 08:46-09:50) (scan 2025-11-19 to 2026-11-13, unlisted-day, wrong-day)' },
    { cnn: '9406000', side: 'NorthEast', was: [['Thu', 0, 6, '11111'], ['Wed', 0, 2, '11111']], now: [['Tues', 0, 2, '11111']],
      why: 'Moss St, Howard St to Folsom St: City Thu 0-6, Wed 0-2; tickets Tues 0-2 (30 dates, 100% at 00:14-00:23) (scan 2025-11-19 to 2026-11-13, unlisted-day, wrong-day, swapped)' },
    { cnn: '2639000', side: 'West', lr: 'L', was: [], now: [['Wed', 6, 8, '11111']],
      why: 'Baker St, Bay St to Bay St: City nothing; tickets Wed 6-8 (29 dates, 100% at 06:33-06:55) (scan 2025-11-19 to 2026-11-13, unlisted-day, side-not-listed)' },
    { cnn: '12433000', side: 'West', was: [['Wed', 2, 6, '11111'], ['Mon', 2, 6, '11111'], ['Fri', 2, 6, '11111']], now: [['Mon', 2, 6, '11111'], ['Fri', 2, 6, '11111'], ['Sat', 2, 6, '11111']],
      why: 'Taylor St, Isadora Duncan Ln to Post St: City Wed 2-6, Mon 2-6, Fri 2-6; tickets Sat 2-6 (29 dates, 100% at 02:15-02:24) (scan 2025-11-19 to 2026-11-13, unlisted-day, wrong-day)' },
    { cnn: '6876000', side: 'South', was: [['Sat', 4, 6, '11111'], ['Thu', 2, 6, '11111'], ['Tues', 2, 6, '11111']], now: [['Tues', 2, 6, '11111'], ['Thu', 2, 6, '11111'], ['Sat', 2, 6, '11111']],
      why: 'Hemlock St, Polk St to Van Ness Ave: City Sat 4-6, Thu 2-6, Tues 2-6; tickets Sat 2-6 (28 dates, 100% at 02:40-02:58) (scan 2025-11-19 to 2026-11-13, wrong-hours)' },
    { cnn: '7480000', side: 'SouthEast', was: [['Fri', 4, 6, '11111']], now: [['Fri', 2, 4, '11111']],
      why: 'Jennings St, Wallace Ave to Yosemite Ave: City Fri 4-6; tickets Fri 2-4 (27 dates, 100% at 02:54-03:06) (scan 2025-11-19 to 2026-11-13, wrong-hours)' },
    { cnn: '12433000', side: 'East', was: [['Tues', 2, 6, '11111'], ['Thu', 2, 6, '11111']], now: [['Sun', 2, 6, '11111']],
      why: 'Taylor St, Isadora Duncan Ln to Post St: City Tues 2-6, Thu 2-6; tickets Sun 2-6 (26 dates, 100% at 02:17-02:33) (scan 2025-11-19 to 2026-11-13, unlisted-day, wrong-day)' },
    { cnn: '3736000', side: 'NorthEast', was: [['Fri', 4, 6, '11111']], now: [['Fri', 2, 4, '11111']],
      why: 'Carroll Ave, Ingalls St to Jennings St: City Fri 4-6; tickets Fri 2-4 (26 dates, 100% at 02:52-03:02) (scan 2025-11-19 to 2026-11-13, wrong-hours)' },
    { cnn: '13144201', side: 'East', was: [['Thu', 2, 6, '11111'], ['Sun', 4, 6, '11111'], ['Tues', 2, 6, '11111'], ['Fri', 2, 6, '11111'], ['Mon', 2, 6, '11111'], ['Wed', 2, 6, '11111'], ['Holiday', 4, 6, '11111'], ['Sat', 4, 6, '11111']], now: [['Sun', 2, 6, '11111'], ['Mon', 2, 6, '11111'], ['Tues', 2, 6, '11111'], ['Wed', 2, 6, '11111'], ['Thu', 2, 6, '11111'], ['Fri', 2, 6, '11111'], ['Sat', 2, 6, '11111'], ['Holiday', 4, 6, '11111']],
      why: 'Van Ness Ave, Fell St to Hayes St: City Thu 2-6, Sun 4-6, Tues 2-6, Fri 2-6, Mon 2-6, Wed 2-6, Sat 4-6; tickets Sun 2-6 (26 dates, 100% at 02:46-03:07), Sat 2-6 (21 dates, 100% at 02:48-03:17) (scan 2025-11-19 to 2026-11-13, wrong-hours)' },
    { cnn: '7352000', side: 'North', lr: 'R', was: [], now: [['Thu', 9, 11, '11111']],
      why: 'Ivy St, Laguna St to Buchanan St: City nothing; tickets Thu 9-11 (26 dates, 100% at 09:36-10:09) (scan 2025-11-19 to 2026-11-13, unlisted-day, side-not-listed)' },
    { cnn: '723000', side: 'South', was: [['Sat', 2, 6, '11111'], ['Thu', 2, 6, '11111'], ['Wed', 2, 6, '11111'], ['Tues', 2, 6, '11111'], ['Holiday', 4, 6, '11111'], ['Sun', 4, 6, '11111'], ['Mon', 2, 6, '11111'], ['Fri', 2, 6, '11111']], now: [['Sun', 2, 6, '11111'], ['Mon', 2, 6, '11111'], ['Tues', 2, 6, '11111'], ['Wed', 2, 6, '11111'], ['Thu', 2, 6, '11111'], ['Fri', 2, 6, '11111'], ['Sat', 2, 6, '11111'], ['Holiday', 4, 6, '11111']],
      why: '16th St, South Van Ness Ave to Capp St: City Sat 2-6, Thu 2-6, Wed 2-6, Tues 2-6, Sun 4-6, Mon 2-6, Fri 2-6; tickets Sun 2-6 (25 dates, 100% at 02:40-02:56) (scan 2025-11-19 to 2026-11-13, wrong-hours)' },
    { cnn: '9497101', side: 'SouthEast', lr: 'L', was: [], now: [['Wed', 6, 8, '11111'], ['Fri', 6, 8, '11111']],
      why: 'Naples St, Geneva Ave to Rolph St: City nothing; tickets Wed 6-8 (25 dates, 100% at 06:12-06:27), Fri 6-8 (20 dates, 100% at 06:09-06:26) (scan 2025-11-19 to 2026-11-13, unlisted-day, side-not-listed)' },
    { cnn: '5116000', side: 'SouthWest', was: [['Fri', 4, 6, '11111']], now: [['Fri', 2, 4, '11111']],
      why: 'Egbert Ave, Jennings St to 03rd St: City Fri 4-6; tickets Fri 2-4 (25 dates, 100% at 02:47-02:55) (scan 2025-11-19 to 2026-11-13, wrong-hours)' },
    { cnn: '8115000', side: 'East', lr: 'L', was: [], now: [['Wed', 9, 11, '11111']],
      why: 'Lapidge St, 18th St to 19th St: City nothing; tickets Wed 9-11 (24 dates, 100% at 09:46-10:05) (scan 2025-11-19 to 2026-11-13, unlisted-day, side-not-listed, row-on-other-side)' },
    { cnn: '3356000', side: 'West', was: [['Thu', 6, 8, '01010'], ['Thu', 6, 8, '10100'], ['Mon', 6, 8, '10100'], ['Mon', 6, 8, '01010']], now: [['Mon', 6, 8, '10100'], ['Mon', 6, 8, '01010'], ['Wed', 6, 8, '11111'], ['Fri', 6, 8, '11111']],
      why: 'Buchanan St, Bay St to North Point St: City Thu 6-8 wk01010, Thu 6-8 wk10100, Mon 6-8 wk10100, Mon 6-8 wk01010; tickets Wed 6-8 (19 dates, 100% at 06:08-06:14), Fri 6-8 (24 dates, 100% at 06:07-06:12) (scan 2025-11-19 to 2026-11-13, unlisted-day, wrong-day)' },
    { cnn: '9706000', side: 'SouthWest', lr: 'L', was: [], now: [['Wed', 9, 11, '11111']],
      why: 'Jerrold Ave, Earl St to Fitch St: City nothing; tickets Wed 9-11 (24 dates, 100% at 09:34-09:50) (scan 2025-11-19 to 2026-11-13, unlisted-day, side-not-listed)' },
    { cnn: '13781000', side: 'SouthWest', was: [['Fri', 4, 6, '11111']], now: [['Fri', 2, 4, '11111']],
      why: 'Yosemite Ave, Jennings St to Keith St: City Fri 4-6; tickets Fri 2-4 (24 dates, 100% at 02:51-03:04) (scan 2025-11-19 to 2026-11-13, wrong-hours)' },
    { cnn: '7051000', side: 'SouthEast', was: [['Tues', 4, 6, '11111'], ['Thu', 4, 6, '11111']], now: [['Tues', 4, 6, '11111'], ['Thu', 2, 4, '11111']],
      why: 'Howard St, 08th St to 09th St: City Tues 4-6, Thu 4-6; tickets Thu 2-4 (23 dates, 100% at 02:53-03:13) (scan 2025-11-19 to 2026-11-13, wrong-hours)' },
    { cnn: '11832000', side: 'East', was: [['Wed', 12, 14, '11111'], ['Fri', 8, 10, '11111']], now: [['Mon', 8, 10, '11111'], ['Thu', 8, 10, '11111']],
      why: 'Shotwell St, 14th St to 15th St: City Wed 12-14, Fri 8-10; tickets Mon 8-10 (23 dates, 100% at 08:06-08:10), Thu 8-10 (22 dates, 100% at 08:10-08:26) (scan 2025-11-19 to 2026-11-13, unlisted-day, wrong-day)' },
    { cnn: '10273000', side: 'East', was: [['Thu', 7, 9, '10100']], now: [['Thu', 7, 9, '11111']],
      why: 'Parker Ave, California St to Euclid Ave: City Thu 7-9 wk10100; tickets Thu 7-9 (23 dates against the City’s weeks) (scan 2025-11-19 to 2026-11-13, wrong-weeks)' },
    { cnn: '13356000', side: 'SouthWest', was: [['Mon', 4, 6, '11111']], now: [['Mon', 2, 4, '11111']],
      why: 'Wallace Ave, Jennings St to Keith St: City Mon 4-6; tickets Mon 2-4 (23 dates, 100% at 03:02-03:26) (scan 2025-11-19 to 2026-11-13, wrong-hours)' },
    { cnn: '11089000', side: 'NorthWest', lr: 'L', was: [], now: [['Wed', 0, 2, '11111']],
      why: 'Rizal St, Tandang Sora to Lapu-lapu St: City nothing; tickets Wed 0-2 (23 dates, 100% at 00:20-00:37) (scan 2025-11-19 to 2026-11-13, unlisted-day, side-not-listed, row-on-other-side)' },
    { cnn: '12726000', side: 'South', was: [['Sun', 4, 6, '11111']], now: [['Thu', 12, 14, '11111']],
      why: 'Turk St, Gough St to Laguna St: City Sun 4-6; tickets Thu 12-14 (22 dates, 100% at 12:04-12:21) (scan 2025-11-19 to 2026-11-13, unlisted-day, wrong-day)' },
    { cnn: '5899000', side: 'North', was: [['Mon', 6, 8, '11111']], now: [['Wed', 8, 10, '11111']],
      why: 'Fulton St, Loyola Ter to Clayton St: City Mon 6-8; tickets Wed 8-10 (22 dates, 100% at 08:20-09:01) (scan 2025-11-19 to 2026-11-13, unlisted-day, wrong-day)' },
    { cnn: '7229000', side: 'SouthEast', was: [['Mon', 4, 6, '11111']], now: [['Wed', 9, 11, '11111']],
      why: 'Ingalls St, Thomas Ave to Underwood Ave: City Mon 4-6; tickets Wed 9-11 (22 dates, 100% at 09:20-09:36) (scan 2025-11-19 to 2026-11-13, unlisted-day, wrong-day)' },
    { cnn: '6875000', side: 'South', was: [['Tues', 2, 6, '11111'], ['Sat', 4, 6, '11111'], ['Thu', 2, 6, '11111']], now: [['Tues', 2, 6, '11111'], ['Thu', 2, 6, '11111'], ['Sat', 2, 6, '11111']],
      why: 'Hemlock St, Larkin St to Polk St: City Tues 2-6, Sat 4-6, Thu 2-6; tickets Sat 2-6 (22 dates, 100% at 02:42-03:00) (scan 2025-11-19 to 2026-11-13, wrong-hours)' },
    { cnn: '10134000', side: 'South', lr: 'L', was: [], now: [['Tues', 7, 9, '11111']],
      why: 'Pacific Ave, Wayne Pl to Mason St: City nothing; tickets Tues 7-9 (22 dates, 100% at 07:08-07:18) (scan 2025-11-19 to 2026-11-13, unlisted-day, side-not-listed)' },
    { cnn: '5588000', side: 'NorthWest', was: [['Sun', 7, 8, '11111'], ['Sat', 7, 8, '11111']], now: [['Fri', 9, 11, '11111']],
      why: 'Arelious Walker Dr, Egbert Ave to Fitzgerald Ave: City Sun 7-8, Sat 7-8; tickets Fri 9-11 (21 dates, 100% at 09:36-09:59) (scan 2025-11-19 to 2026-11-13, unlisted-day, wrong-day)' },
    { cnn: '5115000', side: 'SouthWest', was: [['Fri', 4, 6, '11111']], now: [['Fri', 2, 4, '11111']],
      why: 'Egbert Ave, Ingalls St to Jennings St: City Fri 4-6; tickets Fri 2-4 (21 dates, 100% at 02:49-02:54) (scan 2025-11-19 to 2026-11-13, wrong-hours)' },
    { cnn: '13139000', side: 'SouthWest', was: [['Fri', 4, 6, '11111']], now: [['Fri', 2, 4, '11111']],
      why: 'Van Dyke Ave, Ingalls St to Jennings St: City Fri 4-6; tickets Fri 2-4 (21 dates, 100% at 02:57-03:06) (scan 2025-11-19 to 2026-11-13, wrong-hours)' },
    { cnn: '13216001', side: 'West', lr: 'R', was: [], now: [['Wed', 9, 11, '11111']],
      why: 'Vermont St, 20th St to Vermont St: City nothing; tickets Wed 9-11 (21 dates, 100% at 09:38-09:59) (scan 2025-11-19 to 2026-11-13, unlisted-day, side-not-listed)' },
    { cnn: '13144101', side: 'West', was: [['Holiday', 4, 6, '11111'], ['Sun', 4, 6, '11111'], ['Tues', 2, 6, '11111'], ['Mon', 2, 6, '11111'], ['Wed', 2, 6, '11111'], ['Fri', 2, 6, '11111'], ['Sat', 4, 6, '11111'], ['Thu', 2, 6, '11111']], now: [['Sun', 2, 6, '11111'], ['Mon', 2, 6, '11111'], ['Tues', 2, 6, '11111'], ['Wed', 2, 6, '11111'], ['Thu', 2, 6, '11111'], ['Fri', 2, 6, '11111'], ['Sat', 2, 6, '11111'], ['Holiday', 4, 6, '11111']],
      why: 'Van Ness Ave, Fell St to Hayes St: City Sun 4-6, Tues 2-6, Mon 2-6, Wed 2-6, Fri 2-6, Sat 4-6, Thu 2-6; tickets Sun 2-6 (21 dates, 100% at 02:44-03:00), Sat 2-6 (20 dates, 100% at 02:45-03:26) (scan 2025-11-19 to 2026-11-13, wrong-hours)' },
    { cnn: '9472000', side: 'South', was: [['Tues', 2, 6, '11111'], ['Thu', 2, 6, '11111'], ['Sat', 4, 6, '11111']], now: [['Tues', 2, 6, '11111'], ['Thu', 2, 6, '11111'], ['Sat', 2, 6, '11111']],
      why: 'Alice B Toklas Pl, Polk St to Van Ness Ave: City Tues 2-6, Thu 2-6, Sat 4-6; tickets Sat 2-6 (21 dates, 100% at 02:42-02:58) (scan 2025-11-19 to 2026-11-13, wrong-hours)' },
    { cnn: '12827000', side: 'NorthEast', was: [['Fri', 4, 6, '11111']], now: [['Fri', 2, 4, '11111']],
      why: 'Underwood Ave, Ingalls St to Jennings St: City Fri 4-6; tickets Fri 2-4 (21 dates, 100% at 02:58-03:08) (scan 2025-11-19 to 2026-11-13, wrong-hours)' },
    { cnn: '2461000', side: 'NorthEast', was: [['Fri', 4, 6, '11111']], now: [['Fri', 2, 4, '11111']],
      why: 'Armstrong Ave, Keith St to 03rd St: City Fri 4-6; tickets Fri 2-4 (21 dates, 100% at 02:35-02:59) (scan 2025-11-19 to 2026-11-13, wrong-hours)' },
    { cnn: '13291201', side: 'SouthEast', was: [['Mon', 7, 8, '10101'], ['Mon', 7, 8, '01010']], now: [['Mon', 9, 11, '01010']],
      why: 'Vidal Dr, Arballo Dr to Higuera Ave: City Mon 7-8 wk10101, Mon 7-8 wk01010; tickets Mon 9-11 wk01010 (20 dates, 100% at 09:30-09:52) (scan 2025-11-19 to 2026-11-13, wrong-hours)' },
    { cnn: '5587000', side: 'NorthWest', was: [['Sun', 7, 8, '11111'], ['Sat', 7, 8, '11111']], now: [['Fri', 9, 11, '11111']],
      why: 'Arelious Walker Dr, Carroll Ave to Egbert Ave: City Sun 7-8, Sat 7-8; tickets Fri 9-11 (20 dates, 100% at 09:38-10:03) (scan 2025-11-19 to 2026-11-13, unlisted-day, wrong-day)' },
    { cnn: '645000', side: 'North', was: [['Wed', 12, 14, '11111']], now: [['Thu', 8, 10, '11111']],
      why: '15th St, Folsom St to Shotwell St: City Wed 12-14; tickets Thu 8-10 (20 dates, 100% at 08:11-08:27) (scan 2025-11-19 to 2026-11-13, unlisted-day, wrong-day)' },
    { cnn: '2971000', side: 'North', was: [['Thu', 8, 10, '11111']], now: [['Tues', 8, 10, '11111']],
      why: 'Birch St, Octavia St to Laguna St: City Thu 8-10; tickets Tues 8-10 (20 dates, 100% at 08:38-09:15) (scan 2025-11-19 to 2026-11-13, unlisted-day, wrong-day)' },
    { cnn: '12214000', side: 'West', was: [['Mon', 4, 6, '11111'], ['Wed', 4, 6, '11111'], ['Fri', 4, 6, '11111']], now: [['Mon', 4, 6, '11111'], ['Wed', 2, 4, '11111'], ['Fri', 2, 4, '11111']],
      why: 'Stockton St, Union St to Filbert St: City Mon 4-6, Wed 4-6, Fri 4-6; tickets Wed 2-4 (16 dates, 100% at 03:00-03:28), Fri 2-4 (21 dates, 97% at 02:53-03:29) (scan 2025-11-19 to 2026-11-13, wrong-hours)' },
    { cnn: '108001', side: 'SouthWest', was: [['Thu', 0, 2, '11111'], ['Fri', 0, 2, '11111'], ['Wed', 0, 2, '11111']], now: [['Mon', 0, 2, '11111'], ['Wed', 0, 2, '11111'], ['Fri', 0, 2, '11111']],
      why: '01st St, Tehama St to Clementina St: City Fri 0-2, Wed 0-2, Thu 0-2; tickets Mon 0-2 (19 dates, 100% at 00:24-00:37) (scan 2025-11-19 to 2026-11-13, unlisted-day, wrong-day)' },
    { cnn: '13156201', side: 'East', was: [['Fri', 2, 6, '11111'], ['Sun', 4, 6, '11111'], ['Holiday', 4, 6, '11111'], ['Mon', 2, 6, '11111'], ['Wed', 2, 6, '11111'], ['Tues', 2, 6, '11111'], ['Thu', 2, 6, '11111'], ['Sat', 4, 6, '11111']], now: [['Sun', 2, 6, '11111'], ['Mon', 2, 6, '11111'], ['Tues', 2, 6, '11111'], ['Wed', 2, 6, '11111'], ['Thu', 2, 6, '11111'], ['Fri', 2, 6, '11111'], ['Sat', 4, 6, '11111'], ['Holiday', 4, 6, '11111']],
      why: 'Van Ness Ave, Bush St to Austin St: City Fri 2-6, Sun 4-6, Mon 2-6, Wed 2-6, Tues 2-6, Thu 2-6, Sat 4-6; tickets Sun 2-6 (19 dates, 100% at 02:38-02:55) (scan 2025-11-19 to 2026-11-13, wrong-hours)' },
    { cnn: '2957000', side: 'NorthWest', lr: 'R', was: [], now: [['Tues', 0, 6, '11111']],
      why: 'Berry St, De Haro St to 07th St: City nothing; tickets Tues 0-6 (19 dates, 100% at 00:21-01:03) (scan 2025-11-19 to 2026-11-13, unlisted-day, side-not-listed)' },
    { cnn: '7047000', side: 'SouthEast', was: [['Thu', 4, 6, '11111'], ['Tues', 4, 6, '11111']], now: [['Tues', 4, 6, '11111'], ['Thu', 2, 4, '11111']],
      why: 'Howard St, 07th St to Langton St: City Thu 4-6, Tues 4-6; tickets Thu 2-4 (19 dates, 100% at 02:54-03:16) (scan 2025-11-19 to 2026-11-13, wrong-hours)' },
    { cnn: '12214000', side: 'East', was: [['Thu', 4, 6, '11111'], ['Tues', 4, 6, '11111']], now: [['Tues', 4, 6, '11111'], ['Thu', 2, 4, '11111']],
      why: 'Stockton St, Union St to Filbert St: City Thu 4-6, Tues 4-6; tickets Thu 2-4 (19 dates, 100% at 03:02-03:37) (scan 2025-11-19 to 2026-11-13, wrong-hours)' },
    { cnn: '8966000', side: 'NorthWest', was: [['Fri', 4, 6, '11111']], now: [['Fri', 1, 3, '11111']],
      why: 'Mendell St, Williams Ave to Yosemite Ave: City Fri 4-6; tickets Fri 1-3 (19 dates, 100% at 01:19-02:02) (scan 2025-11-19 to 2026-11-13, wrong-hours)' },
    { cnn: '7495000', side: 'SouthWest', was: [['Fri', 9, 11, '11111']], now: [['Wed', 9, 11, '11111']],
      why: 'Jerrold Ave, Earl St to Donahue St: City Fri 9-11; tickets Wed 9-11 (18 dates, 100% at 09:29-09:51) (scan 2025-11-19 to 2026-11-13, unlisted-day, wrong-day)' },
    { cnn: '6597000', side: 'East', was: [['Tues', 0, 2, '11111']], now: [['Thu', 0, 2, '11111']],
      why: 'Guy Pl, 01st St to Lansing St: City Tues 0-2; tickets Thu 0-2 (18 dates, 100% at 00:31-00:44) (scan 2025-11-19 to 2026-11-13, unlisted-day, wrong-day)' },
    { cnn: '12017101', side: 'East', was: [['Sun', 4, 6, '11111'], ['Sat', 4, 6, '11111'], ['Fri', 0, 2, '11111'], ['Thu', 0, 6, '11111'], ['Mon', 0, 2, '11111'], ['Wed', 0, 2, '11111'], ['Tues', 0, 6, '11111']], now: [['Sun', 0, 6, '11111'], ['Mon', 0, 2, '11111'], ['Tues', 0, 6, '11111'], ['Wed', 0, 2, '11111'], ['Thu', 0, 6, '11111'], ['Fri', 0, 2, '11111'], ['Sat', 4, 6, '11111']],
      why: 'South Van Ness Ave, 12th St to Howard St: City Sun 4-6, Sat 4-6, Fri 0-2, Thu 0-6, Mon 0-2, Wed 0-2, Tues 0-6; tickets Sun 0-6 (18 dates, 100% at 02:51-03:13) (scan 2025-11-19 to 2026-11-13, wrong-hours)' },
    { cnn: '11520000', side: 'West', lr: 'R', was: [], now: [['Wed', 9, 11, '11111']],
      why: 'Sanchez St, Cumberland St to 20th St: City nothing; tickets Wed 9-11 (18 dates, 100% at 09:20-09:38) (scan 2025-11-19 to 2026-11-13, unlisted-day, side-not-listed)' },
    { cnn: '961000', side: 'North', lr: 'R', was: [], now: [['Thu', 0, 6, '11111']],
      why: '19th St, York St to Bryant St: City nothing; tickets Thu 0-6 (18 dates, 95% at 00:26-00:36) (scan 2025-11-19 to 2026-11-13, unlisted-day, side-not-listed)' },
    { cnn: '8843201', side: 'West', was: [['Wed', 8, 10, '11111']], now: [['Wed', 6, 8, '11111'], ['Thu', 6, 8, '11111']],
      why: 'Masonic Ave, Geary Blvd to Anza St: City Wed 8-10; tickets Wed 6-8 (17 dates, 100% at 06:26-06:56), Thu 6-8 (16 dates, 100% at 06:24-07:00) (scan 2025-11-19 to 2026-11-13, wrong-hours, unlisted-day, missing-day, swapped)' },
    { cnn: '12096000', side: 'West', was: [['Tues', 8, 10, '10000']], now: [['Fri', 7, 9, '11111']],
      why: 'Stanyan St, Parnassus Ave to Grattan St: City Tues 8-10 wk10000; tickets Fri 7-9 (17 dates, 100% at 07:11-07:20) (scan 2025-11-19 to 2026-11-13, unlisted-day, wrong-day)' },
    { cnn: '3582000', side: 'South', was: [['Tues', 9, 11, '01010']], now: [['Mon', 9, 11, '01010'], ['Wed', 9, 11, '01010']],
      why: 'California St, 06th Ave to 07th Ave: City Tues 9-11 wk01010; tickets Mon 9-11 wk01010 (17 dates, 100% at 09:14-09:19), Wed 9-11 wk01010 (15 dates, 100% at 09:16-09:31) (scan 2025-11-19 to 2026-11-13, unlisted-day, wrong-day)' },
    { cnn: '4663000', side: 'East', lr: 'L', was: [], now: [['Wed', 9, 11, '11111']],
      why: 'Dearborn St, 17th St to Bird St: City nothing; tickets Wed 9-11 (17 dates, 100% at 09:47-10:03) (scan 2025-11-19 to 2026-11-13, unlisted-day, side-not-listed, row-on-other-side)' },
    { cnn: '7616000', side: 'West', was: [['Thu', 7, 9, '10100']], now: [['Thu', 7, 9, '11111']],
      why: 'Jordan Ave, California St to Euclid Ave: City Thu 7-9 wk10100; tickets Thu 7-9 (17 dates against the City’s weeks) (scan 2025-11-19 to 2026-11-13, wrong-weeks)' },
    { cnn: '5116000', side: 'NorthEast', was: [['Mon', 4, 6, '11111']], now: [['Mon', 2, 4, '11111']],
      why: 'Egbert Ave, Jennings St to 03rd St: City Mon 4-6; tickets Mon 2-4 (17 dates, 100% at 02:50-03:08) (scan 2025-11-19 to 2026-11-13, wrong-hours)' },
    { cnn: '5919000', side: 'South', was: [['Wed', 9, 11, '10101'], ['Wed', 9, 11, '01010']], now: [['Thu', 13, 15, '11111']],
      why: 'Fulton St, Funston Ave to Park Presidio Blvd: City Wed 9-11 wk10101, Wed 9-11 wk01010; tickets Thu 13-15 (17 dates, 100% at 13:10-13:16) (scan 2025-11-19 to 2026-11-13, unlisted-day, wrong-day)' },
    { cnn: '8458201', side: 'North', was: [['Thu', 6, 8, '10100'], ['Tues', 6, 8, '10100'], ['Tues', 6, 8, '01010']], now: [['Tues', 6, 8, '10100'], ['Tues', 6, 8, '01010'], ['Thu', 6, 8, '11111']],
      why: 'Lombard St, Buchanan St to Webster St: City Thu 6-8 wk10100, Tues 6-8 wk10100, Tues 6-8 wk01010; tickets Thu 6-8 (17 dates against the City’s weeks) (scan 2025-11-19 to 2026-11-13, wrong-weeks)' },
    { cnn: '13784000', side: 'SouthWest', was: [['Fri', 4, 6, '11111']], now: [['Fri', 1, 3, '11111']],
      why: 'Yosemite Ave, Lane St to Mendell St: City Fri 4-6; tickets Fri 1-3 (17 dates, 100% at 02:18-02:50) (scan 2025-11-19 to 2026-11-13, wrong-hours)' },
    { cnn: '10165000', side: 'North', lr: 'R', was: [], now: [['Tues', 12, 14, '10100']],
      why: 'Pacific Ave, Walnut St to Laurel St: City nothing; tickets Tues 12-14 wk10100 (17 dates, 100% at 12:43-13:02) (scan 2025-11-19 to 2026-11-13, unlisted-day, side-not-listed)' },
    { cnn: '13784000', side: 'NorthEast', was: [['Mon', 4, 6, '11111']], now: [['Mon', 2, 4, '11111']],
      why: 'Yosemite Ave, Lane St to Mendell St: City Mon 4-6; tickets Mon 2-4 (17 dates, 100% at 02:50-03:07) (scan 2025-11-19 to 2026-11-13, wrong-hours)' },
    { cnn: '5358000', side: 'SouthWest', lr: 'R', was: [], now: [['Wed', 9, 11, '11111']],
      why: 'Ewing Ter, Jean Way to Ewing Ter: City nothing; tickets Wed 9-11 (17 dates, 100% at 08:48-09:52) (scan 2025-11-19 to 2026-11-13, unlisted-day, side-not-listed)' },
    { cnn: '1053000', side: 'North', was: [['Tues', 6, 8, '11111'], ['Thu', 9, 11, '11111']], now: [['Tues', 6, 8, '11111'], ['Thu', 6, 8, '11111']],
      why: '20th St, Shotwell St to South Van Ness Ave: City Tues 6-8, Thu 9-11; tickets Thu 6-8 (18 dates, 96% at 06:08-06:30) (scan 2025-11-19 to 2026-11-13, wrong-hours)' },
    { cnn: '11358000', side: 'West', lr: 'R', was: [], now: [['Tues', 6, 8, '11111']],
      why: 'San Bruno Ave, San Bruno Ave to 22nd St: City nothing; tickets Tues 6-8 (16 dates, 100% at 06:27-06:39) (scan 2025-11-19 to 2026-11-13, unlisted-day, side-not-listed, row-on-other-side)' },
    { cnn: '4907000', side: 'SouthWest', was: [['Fri', 4, 6, '11111']], now: [['Fri', 2, 4, '11111']],
      why: 'Donner Ave, Hawes St to Ingalls St: City Fri 4-6; tickets Fri 2-4 (16 dates, 100% at 02:50-03:03) (scan 2025-11-19 to 2026-11-13, wrong-hours)' },
    { cnn: '4993000', side: 'South', was: [['Fri', 12, 14, '11111']], now: [['Fri', 6, 8, '11111']],
      why: 'Duboce Ave, Castro St to Divisadero St: City Fri 12-14; tickets Fri 6-8 (16 dates, 100% at 06:31-07:02) (scan 2025-11-19 to 2026-11-13, wrong-hours)' },
    { cnn: '3357000', side: 'East', was: [['Wed', 6, 8, '11111'], ['Wed', 6, 8, '11111']], now: [['Tues', 6, 8, '11111'], ['Thu', 6, 8, '11111']],
      why: 'Buchanan St, North Point St to Beach St: City Wed 6-8, Wed 6-8; tickets Tues 6-8 (15 dates, 100% at 06:10-06:18), Thu 6-8 (16 dates, 95% at 06:05-06:08) (scan 2025-11-19 to 2026-11-13, unlisted-day, wrong-day, swapped)' },
    { cnn: '2423000', side: 'East', was: [['Thu', 7, 9, '10100']], now: [['Thu', 7, 9, '11111']],
      why: 'Arguello Blvd, Geary Blvd to Anza St: City Thu 7-9 wk10100; tickets Thu 7-9 (15 dates against the City’s weeks) (scan 2025-11-19 to 2026-11-13, wrong-weeks)' },
    { cnn: '13161101', side: 'West', was: [['Sun', 4, 6, '11111'], ['Mon', 2, 6, '11111'], ['Fri', 2, 6, '11111'], ['Sat', 4, 6, '11111'], ['Holiday', 4, 6, '11111'], ['Tues', 2, 6, '11111'], ['Thu', 2, 6, '11111'], ['Wed', 2, 6, '11111']], now: [['Sun', 2, 6, '11111'], ['Mon', 2, 6, '11111'], ['Tues', 2, 6, '11111'], ['Wed', 2, 6, '11111'], ['Thu', 2, 6, '11111'], ['Fri', 2, 6, '11111'], ['Sat', 4, 6, '11111'], ['Holiday', 4, 6, '11111']],
      why: 'Van Ness Ave, Washington St to Jackson St: City Sun 4-6, Mon 2-6, Fri 2-6, Sat 4-6, Tues 2-6, Thu 2-6, Wed 2-6; tickets Sun 2-6 (15 dates, 100% at 02:38-03:10) (scan 2025-11-19 to 2026-11-13, wrong-hours)' },
    { cnn: '3143000', side: 'North', was: [['Thu', 2, 6, '11111'], ['Tues', 2, 6, '11111'], ['Sun', 4, 6, '11111'], ['Sat', 4, 6, '11111'], ['Fri', 2, 6, '11111'], ['Holiday', 4, 6, '11111'], ['Mon', 2, 6, '11111'], ['Wed', 2, 6, '11111']], now: [['Sun', 4, 6, '11111'], ['Mon', 2, 6, '11111'], ['Tues', 2, 6, '11111'], ['Wed', 2, 6, '11111'], ['Thu', 2, 6, '11111'], ['Fri', 2, 6, '11111'], ['Sat', 2, 6, '11111'], ['Holiday', 4, 6, '11111']],
      why: 'Broadway, Davis St to Front St: City Thu 2-6, Tues 2-6, Sun 4-6, Sat 4-6, Fri 2-6, Mon 2-6, Wed 2-6; tickets Sat 2-6 (15 dates, 100% at 02:25-02:33) (scan 2025-11-19 to 2026-11-13, wrong-hours)' },
    { cnn: '4837000', side: 'North', lr: 'R', was: [], now: [['Mon', 0, 6, '11111']],
      why: 'Division St, King St to Rhode Island St: City nothing; tickets Mon 0-6 (15 dates, 100% at 00:09-00:13) (scan 2025-11-19 to 2026-11-13, unlisted-day, side-not-listed)' },
    { cnn: '13160201', side: 'East', was: [['Sun', 4, 6, '11111'], ['Fri', 2, 6, '11111'], ['Sat', 4, 6, '11111'], ['Holiday', 4, 6, '11111'], ['Thu', 2, 6, '11111'], ['Wed', 2, 6, '11111'], ['Mon', 2, 6, '11111'], ['Tues', 2, 6, '11111']], now: [['Sun', 2, 6, '11111'], ['Mon', 2, 6, '11111'], ['Tues', 2, 6, '11111'], ['Wed', 2, 6, '11111'], ['Thu', 2, 6, '11111'], ['Fri', 2, 6, '11111'], ['Sat', 4, 6, '11111'], ['Holiday', 4, 6, '11111']],
      why: 'Van Ness Ave, Clay St to Washington St: City Sun 4-6, Fri 2-6, Sat 4-6, Thu 2-6, Wed 2-6, Mon 2-6, Tues 2-6; tickets Sun 2-6 (15 dates, 100% at 02:36-03:03) (scan 2025-11-19 to 2026-11-13, wrong-hours)' },
    { cnn: '7617000', side: 'West', was: [['Thu', 7, 9, '10100']], now: [['Thu', 7, 9, '11111']],
      why: 'Jordan Ave, Euclid Ave to Geary Blvd: City Thu 7-9 wk10100; tickets Thu 7-9 (15 dates against the City’s weeks) (scan 2025-11-19 to 2026-11-13, wrong-weeks)' },
    { cnn: '13780000', side: 'SouthWest', was: [['Fri', 4, 6, '11111']], now: [['Fri', 2, 4, '11111']],
      why: 'Yosemite Ave, Ingalls St to Jennings St: City Fri 4-6; tickets Fri 2-4 (15 dates, 100% at 02:56-03:05) (scan 2025-11-19 to 2026-11-13, wrong-hours)' },
    { cnn: '12827000', side: 'SouthWest', was: [['Mon', 4, 6, '11111']], now: [['Mon', 2, 4, '11111']],
      why: 'Underwood Ave, Ingalls St to Jennings St: City Mon 4-6; tickets Mon 2-4 (15 dates, 100% at 03:06-03:21) (scan 2025-11-19 to 2026-11-13, wrong-hours)' },
    // scan:end
  ];

  const WEEKS = ['week1', 'week2', 'week3', 'week4', 'week5'];
  const rowSig = (weekday, from, to, weeks) => [weekday, +from, +to, weeks].join('|');
  const sigOf = (rows) => rows.map((r) => rowSig(r.weekday, r.fromhour, r.tohour, WEEKS.map((k) => r[k]).join(''))).sort().join(';');
  const wasSig = (f) => f.was.map((w) => rowSig(w[0], w[1], w[2], w[3])).sort().join(';');
  const onSide = (f) => (r) => String(r.cnn) === f.cnn && r.blockside === f.side;

  /** The City's rows with every fix that still applies. Rows must carry cnn, blockside, weekday, fromhour, tohour and
   *  week1..week5; a side whose rows differ from `was` in any way is left exactly as the City has it. A side the City
   *  doesn't list (`was` empty, `lr` its cnnrightleft) is built from the block's other side, which carries the line. */
  function applySweepFixes(rows) {
    if (!Array.isArray(rows) || !rows.length) return rows;
    let out = rows;
    for (const f of FIXES) {
      const mine = onSide(f);
      const cur = rows.filter(mine);
      if (sigOf(cur) !== wasSig(f)) continue;
      const other = !cur.length && rows.find((r) => String(r.cnn) === f.cnn);
      if (!cur.length && !other) continue;  // this block isn't in these rows
      const t = cur.length ? cur[0] : Object.assign({}, other, { blockside: f.side, cnnrightleft: f.lr, holidays: '0' });
      const fixed = f.now.map((n) => {
        const r = Object.assign({}, t, { weekday: n[0], fromhour: String(n[1]), tohour: String(n[2]) });
        WEEKS.forEach((k, i) => { r[k] = n[3][i]; });
        return r;
      });
      out = out.filter((r) => !mine(r)).concat(fixed);
    }
    return out;
  }

  /** Fixes the City's current rows no longer match: the City changed that side, so the fix is off and needs a look.
   *  `rows` must hold every City row for the fixes' cnns. */
  function staleSweepFixes(rows) {
    return FIXES.filter((f) => sigOf((rows || []).filter(onSide(f))) !== wasSig(f));
  }

  root.SF_SWEEP_FIXES = FIXES;
  root.applySweepFixes = applySweepFixes;
  root.staleSweepFixes = staleSweepFixes;
})(globalThis);
