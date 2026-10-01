# Buenos Aires

Researched 2026-10-01 from official sources (the Traffic Code, the official gazette, City pages and the
City's data servers), then re-checked by two independent passes, one on the data and one on the law.
Cross origin checks were sent as `Origin: https://curb.guide`. Anything marked "not verified" could not
be confirmed that day. Prices in pesos change often, so this page names where each one is set instead of
repeating it.

## Short version

- **It is not a street sweeping city.** Nothing in the Traffic Code ties street cleaning to parking, and
  the City publishes no sweeping schedule.
- **The City publishes the parking rule per curb side, with geometry, in one layer.** 51,755 side lines
  for the whole city. This is better data than San Francisco or Boston give us: no join needed. It is not
  perfect: about one block in ten has only one of its two sides in the layer.
- The question a driver has there is "can I leave the car on this side of this block now, until when,
  and do I pay". The whole city reduces to four states per curb side.
- One of those states behaves exactly like a sweeping window: **no parking on business days from 7:00 to
  21:00**, mostly on avenues, towable, and unsigned on most of them because it is the general rule.
  CURB's existing schedule and alert logic can run it as it is.
- Three things stand between this and a launch: the layer's terms say personal use only and no
  commercial use (ask for permission), the map needs to draw rules that are not sweeping (a design
  decision), and everything has to be in Spanish.

## How parking works

Source: Código de Tránsito y Transporte (Ley 2148), Title 7, in its updated text, and the City's plain
language page "Normas de estacionamiento".

1. **The general rule** (article 7.1.2, as changed by Ley 6546; applied since Monday 17 April 2023). It is
   not signed, except on the main avenues into the city.
   - Avenues: no parking on either side on business days from 7:00 to 21:00. Allowed at night, on
     weekends (Saturdays included) and on holidays.
   - Streets: parking allowed on both sides, all day. The old "one side only" general rule is gone, and
     many older sources still describe it. One side parking survives where a sign says so: about 1,160
     rows of the current legal list forbid the left side all day.
   - Streets and avenues with Metrobús, and the lane next to a bike lane: no parking at any time.
     Passages with a roadway up to 4.5 m: no parking. Wider passages: allowed on both sides.
2. **Rules per block** (article 7.1.16). The City can set a different rule for a block side. A sign is
   required for those, and for any ban that covers only part of a block or particular hours (article
   7.1.12). The legal list today is annex I of Resolución 223/SECTR/26 (50 pages: street, from, to, side,
   rule, hours), published 29 September 2026. It replaced a chain of earlier lists that began with
   Resolución 216/SECTOP/23. Only two schedules exist in the law and in the data: "24 hours" and
   "business days 7 to 21".
3. **Places that are never legal inside an allowed block** (articles 7.1.8 and 7.1.9): corners,
   crosswalks, garage entrances (and one meter either side), ramps, passenger transport stops, within
   10 m of the entrance of schools in class hours, hospitals, banks in opening hours, and more. Some
   apply without a sign (corners, garage entrances); the 10 m entrance bans, reserved spaces, street
   markets and loading zones need one. None of this is in any dataset.
4. **Paid parking** (chapter 7.4). No meters since June 2022: people pay in the Blinkay app or at shops,
   and Blinkay kept the concession in the 2026 tender. Business days 8:00 to 20:00, Saturdays 8:00 to
   13:00, free on Sundays and holidays. It covers 10,552 spaces in parts of San Telmo, Monserrat,
   Balvanera, San Nicolás, Retiro, Recoleta, Puerto Madero (added in 2024) and Almagro (the Hospital
   Italiano area, added in February 2025). Two price modes: Sencilla (the City's page calls it "simple")
   and Progresiva, where each hour costs more than the one before. Prices are set by decree; the last
   change found took effect in July 2026. Residents of the paid zone park free in a zone of at least
   300 m around home.
5. **Towing** (article 2.1.5). Breaking the general rule is towable, so the weekday avenue ban is a tow
   risk, not only a fine. Unpaid meter time is not in the tow list. The City runs towing through AUSA,
   with four impound lots open all day. The fee is set by resolution (Resolución 128/SECTR/26 in 2026).
6. **Fines** (Ley 451, article 6.1.52) are set in "unidades fijas", not in pesos: 100 units for
   prohibited parking, doubled at passenger transport stops, vehicle entrances, bike lanes, exclusive
   lanes, Metrobús corridors and in the downtown zones, and 300 in disability spaces or on ramps. One
   unit is the price of half a liter of premium petrol, fixed every six months and published by the
   City's statistics office (estadisticaciudad.gob.ar/eyc/unidad-fija-uf).
7. **Loading zones** ("cajones azules"): 30 minutes unless the sign says otherwise.
8. **Time.** UTC-3 all year, no daylight saving since 2009. "Business days" means the national holiday calendar
   matters. Whether bridge days and non working days count is not verified.

## What the City publishes

| Need | Dataset | Notes |
|---|---|---|
| **The rule for every curb side** | IDECABA layer `catalogo_og_130:estacionamiento_normativa` ("Estacionamiento en vía pública - Normativa"), on `geoserver.buenosaires.gob.ar` (WFS and WMS) | 51,755 lines, one per curb side, already drawn about 4.5 m from the centerline. 23,848 of 26,696 numbered blocks have both sides; 2,555 have only one. Fields: street `nam`, street type `tvc`, side `ldo`, address range `ade` to `aha`, rule `rgl`, tariff `trf`. Open to browsers. The full file is 26 MB and takes two minutes, so it is baked at build time. Dated March 2026, updated "as needed". **Terms: personal use, source credited, no commercial use** (see Risks) |
| The same rules, old copy | BA Data "Estacionamiento en la Vía Pública" | From early 2020, before the 2022 rule change. Open license (CC BY 2.5 AR) but out of date, and its odd or even column is wrong on streets numbered against the traffic. Do not use it |
| Street centerlines | BA Data "Calles" (callejero), also on the same map server | 31,961 blocks with odd and even address ranges and the direction of traffic. The right side of a line's drawing direction is the odd side (25,818 of 25,821 numbered blocks). CC BY 2.5 AR, refreshed twice a year |
| Which sides are paid | A City PDF, "Tramos Tarifado Feb-25" | 737 rows (733 unique, 54 covering more than one block) with the price mode. All of them match the curb layer by street, side and address range. The layer's own tariff field disagrees with it (150 rows have no tariff there, and 1,173 sides with a tariff are sides where parking is forbidden all day), so the PDF is the better source, and it is from February 2025 |
| Address search and "where am I" | USIG services (normalizar, reverse geocoding) | Open to browsers, no key. The reverse geocoder returns the block's address range, which is the key into the curb layer |
| The legal list of special rules | Resolución 223/SECTR/26, annex I (official gazette, 29 September 2026) | A PDF. Good for auditing the layer, not as data |
| Metrobús, bike lanes, bus stops, taxi stands, ramps, schools, weekly street markets | The same map server and BA Data | Points and lines for context. No side of street and no extents |
| Loading zones, garages, motorcycle boxes | BA Data | Points from 2019. Old |
| Enforcement signal | BA Data, citizen reports (SUACI), category "Vehículo mal estacionado" | Complaints with time and place. Not tickets |
| Tickets and tows | Not published | Only a lookup by plate |
| Holidays | The national government's file behind argentina.gob.ar/feriados: `https://www.argentina.gob.ar/sites/default/files/holidays-2026-es.json` | 35 entries for 2026, each with its kind (fixed, movable, bridge, non working day). Community holiday APIs were missing two November 2026 entries that this file has, so use the official file, read at build time |

The seven values of the rule field, by number of curb sides:

| Rule in the layer | Sides | CURB rule |
|---|---|---|
| PERMITIDO ESTACIONAR 24 HORAS | 34,949 | none: parking allowed |
| PROHIBIDO ESTACIONAR 24 HORAS | 8,771 | `no_parking`, all day |
| PROHIBIDO ESTACIONAR DIAS HABILES DE 7 A 21 HORAS | 5,339 | `no_parking`, Monday to Friday 07:00 to 21:00, suspended on holidays |
| PROHIBIDO ESTACIONAR Y DETENERSE 24 HORAS | 2,297 | `no_stopping`, all day |
| PERMITIDO ESTACIONAR A 45° 24 HORAS (204), A 90° 24 HORAS (103), PARALELO A CICLOVIA 24 HORAS (92) | 399 | none: parking allowed, with a note |

By curb length, about two thirds of the city is free all day, about a fifth is never allowed, and about a
tenth has the weekday window.

## A worked example

Av. Santa Fe between 3201 and 3260, straight from the layer. Sides there are named relative to the
direction of traffic. The right side is never allowed. The left side has the weekday window.

```json
{
  "id": "santa-fe-av-3201", "street": "Av. Santa Fe", "from": "3201", "to": "3260",
  "sides": [
    { "side": "R", "label": "Derecha",
      "line": [[-58.41015, -34.5889], [-58.41093, -34.58837]],
      "rules": [ { "type": "no_parking", "tow": true, "source_id": "41688", "time_spans": [{}] } ] },
    { "side": "L", "label": "Izquierda",
      "line": [[-58.41024, -34.58905], [-58.41101, -34.58853]],
      "rules": [ { "type": "no_parking", "tow": true, "holidays": "suspended", "source_id": "41696",
        "time_spans": [{ "days_of_week": ["mon", "tue", "wed", "thu", "fri"],
                         "time_of_day_start": "07:00", "time_of_day_end": "21:00" }] } ] }
  ]
}
```

An empty time span means "always". The layer has no block id, so the id has to be built from the street
and the address range, or taken from the centerline file.

## What a first version shows

- **Map.** Every curb side in one of four states: free, never, "free until 7:00 on the next business
  day", and paid now.
- **Block sheet.** The rule as the City words it, the hours, whether it is paid and the price mode, a link
  to Blinkay, the tow risk, and the standing list of places that are never legal inside a block.
- **Alerts.** "You are on an avenue side. Move before 7:00 tomorrow." This is the sweeping alert with a
  different sentence: the weekday window is five rules, Monday to Friday 7 to 21, suspended on holidays,
  and `makeTimeCore({ tz: 'America/Argentina/Buenos_Aires', … })` already computes it (there is a test
  for it in `lib/sweep-core.test.mjs`). A second alert, "paid hours start at 8:00", uses the same logic.
- Level 2 in the terms of [README.md](README.md). No ticket times: there is no ticket data.

## What it cannot do

- **Say that an exact spot is legal.** Signs, garage entrances, bus stop lengths, reserved spaces and
  painted curbs are not published. CURB can say "this side allows parking", never "this spot is legal",
  and the page has to say so.
- Paid status per side is only as good as a February 2025 PDF.
- Ticket or tow risk by block and hour.
- Temporary closures and events.

## Risks

1. **License.** The layer's record says the data is "para uso personal e intransferible" and that
   "Queda estrictamente prohibido cualquier aprovechamiento o explotación del diseño y los Contenidos
   -por cualquier medio-, con fines comerciales", with an exception for educational or science outreach
   projects that credit the source. The same text sits on 139 of the 140 datasets in that catalog, so it
   is boilerplate, and the City's general site terms use an open license (CC BY 2.5 AR) without naming
   this catalog. CURB is free and has no ads, but republishing the layer in an app is our reading, not
   the City's. Get written permission, or ask them to republish the layer on BA Data under its open
   license, before launch.
2. **Freshness.** The layer is from March 2026 and its record says it is updated "as needed". The legal
   list was replaced on 29 September 2026, so the layer is at least one revision behind. Show the data
   date, and ask how often the layer is refreshed.
3. **The City already answers this question** through its WhatsApp bot (Boti) and its own map viewer. The
   value of CURB there is the map at a glance, knowing the time, and the alert.
4. The open data portal blocks non-browser requests and challenges bursts. Fetch slowly, at build time,
   never from visitors' phones.

## What to ask the City for

1. Permission to use the curb layer in a free public app, or its republication on BA Data under CC BY,
   with a stated refresh frequency. (IDECABA and the BA Data team, datosabiertos@buenosaires.gob.ar.)
2. The current list of paid block sides as a file, with price mode and hours, and the zone outline.
   (The office that owns curb rules: Gerencia Operativa Estacionamiento Ordenado y Regulación del Cordón,
   Secretaría de Tránsito.)
3. What the tariff field means on sides where parking is forbidden, and stable block ids in the layer.
4. Whether "business days" excludes bridge days and non working days.
5. Loading zones with side, length and hours; reserved spaces; which side each bike lane is on.
6. Through an access to information request (Ley 104): parking fines and tows for the last three years
   with date, time and place, anonymized. This is what "when tickets land" would need.

## How Buenos Aires maps onto CURB

- Data: one script reads the curb layer and the centerlines and writes the shared format. No geometry
  join. The layer names sides relative to the direction of traffic (its own record says so, and 97.6% of
  50,644 lines agree with the centerline file); odd and even come from that join. The other 2.4%, the
  606 lines with no address range and the 20 with no street name need a rule or a hand fix.
- Time: UTC-3, no daylight saving, national holidays.
- New for CURB: curb sides whose state never changes (always free, never allowed), paid hours as a
  second kind of window, Spanish for the interface and the alerts, fines that are not a fixed amount.
- The working files of this research are large and are not in the repo. The layer can be downloaded
  again from the map server in two minutes.
