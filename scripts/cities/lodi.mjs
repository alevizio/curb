#!/usr/bin/env node
// Lodi, New Jersey (Borough of Lodi, Bergen County): data/lodi/ from two public sources.
//
//   1. The Borough's Code, Chapter 560 (Vehicles and Traffic), Article II, § 560-38 "Schedule II: No Parking Certain
//      Hours" (https://ecode360.com/13641874). One row per street and side: the hours and day, and the stretch in
//      words ("From Burns Avenue to Farnham Avenue", "Entire length"). § 560-27C makes parking in those hours a
//      violation, § 560-28 sets the penalty (not more than $50), and § 560-38C suspends the schedule "when the street
//      sweepers of the Borough of Lodi are not operable": this is the Borough's street sweeping schedule.
//      ecode360 refuses scripts (a browser check), so the rows are transcribed below (CODE_ROWS, read 2026-11-11 in a
//      browser). Two rows that name a single house number (a morning and evening rule in front of one address) are
//      not transcribed.
//   2. The State's street centerlines (NJ Office of GIS, NG9-1-1 "Tran_road"): the block lines, names, house number
//      ranges and which town each side is in. The same layer Paterson's build reads (scripts/cities/paterson.mjs).
//
// How a row becomes blocks: the street's centerlines coded to Lodi are lined up along the street; each limit ("to
// Farnham Avenue") is placed where that street meets it in the layer; every block whose middle lies between the two
// limits gets the row's hours on the side the Code names. Rows the build cannot read as a plain weekly window
// ("All; except ...", blank hours, "except Saturday, Sunday, and holidays") are left out and listed in the report, and
// so is a stretch with a limit the layer cannot place: nothing is guessed.
//
// PRIVACY: the State layer carries its editor's user name (EDITOR); it is never requested, never cached. No person's
// name, phone, plate or address is read or written anywhere in this build.
//
//   node scripts/cities/lodi.mjs             build from the cached centerlines (private/cache/lodi/)
//   node scripts/cities/lodi.mjs --refresh   fetch the centerlines again
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  ROADS, TZ, NO_CURB, MIN_BLOCK, titleCase, streetName, isStreetName, oddSide, houseRange, xy, lengthM, round6, midpoint, parts, crossStreets,
} from './paterson.mjs';
import { sideFacing, compass4 } from './hoboken.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = ROOT + 'data/lodi/';
const CACHE = process.env.CURB_CACHE_DIR || ROOT + 'private/cache/lodi/';
const log = (...a) => console.log('[lodi]', ...a);

export const CODE_URL = 'https://ecode360.com/13641874';
export const CODE_READ = '2026-11-11';
export const LODI = '885284';                                   // the Borough's GNIS code in INCMUNI_L / INCMUNI_R
export const ENVELOPE = [-74.105, 40.858, -74.060, 40.898];     // Lodi and the streets around it (limits can lie outside)
const ROAD_FIELDS = ['OBJECTID', 'RCL_NGUID', 'FROMADDR_L', 'TOADDR_L', 'FROMADDR_R', 'TOADDR_R', 'PARITY_L', 'PARITY_R', 'ST_PREDIR', 'ST_NAME',
  'ST_POSTYP', 'ST_POSDIR', 'PRIMENAME', 'LST_PNAME', 'INCMUNI_L', 'INCMUNI_R', 'ROADCLASS', 'STATUSTYP'];

// Every week, all year. Flag 1 (not stopped by a holiday): the Code names no holiday on which the schedule is off.
export const WEEKS = 31, MONTHS = 0, FLAGS = 1;

// ---------- the Code's rows ------------------------------------------------------------------------
// Street|Side|Hours and day|Location, as printed (the Code's own spellings). "  # ..." is the Code's amendment note.
export const CODE_ROWS = `
Adams Place|North|9:00 a.m. to 3:00 p.m., Monday|Entire length
Adams Place|South|9:00 a.m. to 3:00 p.m., Thursday|From 150 feet east of South Main Street to Prospect Street
Aida Court|North|9:00 a.m. to 3:00 p.m., Tuesday|Entire length
Aida Court|South|9:00 a.m. to 3:00 p.m., Friday|Entire length
Annette Terrace|East|9:00 a.m. to 3:00 p.m., Friday|Entire length
Annette Terrace|West|9:00 a.m. to 3:00 p.m., Wednesday|Entire length
Arlene Grove|East|9:00 a.m. to 3:00 p.m., Friday|Entire length
Arlene Grove|West|9:00 a.m. to 3:00 p.m., Wednesday|Entire length
Arnot Place|East|9:00 a.m. to 3:00 p.m., Wednesday|Entire length
Arnot Place|West|All; except 9:00 a.m. to 3:00 p.m., Wednesday|Entire length
Arnot Street|North|9:00 a.m. to 3:00 p.m., Monday|From Dell Glen Avenue to Farnham Avenue
Arnot Street|South|10:00 a.m. to 11:00 a.m., Wednesday|From Burns Avenue to Farnham Avenue  # Amended 11-12-1991 by Ord. No. 192-8
Autumn Street|North|9:00 a.m. to 3:00 p.m., Monday|From Prospect Street to Grove Street
Autumn Street|South|11:00 a.m. to 12:00 p.m., Thursday|Entire length  # Amended 11-12-1991 by Ord. No. 192-8
Avenue A|North|9:00 a.m. to 3:00 p.m., Wednesday|Entire length
Avenue A|South|9:00 a.m. to 3:00 p.m., Friday|Entire length
Avenue B|North|9:00 a.m. to 3:00 p.m., Wednesday|Entire length
Avenue B|South|9:00 a.m. to 3:00 p.m., Friday|Entire length
Avenue C|North|9:00 a.m. to 3:00 p.m., Wednesday|Entire length
Avenue C|South|1:00 p.m. to 2:00 p.m., Friday|Entire length  # Amended 11-12-1991 by Ord. No. 192-8
Avenue D|North|9:00 a.m. to 3:00 p.m., Wednesday|Entire length
Avenue D|South|9:00 a.m. to 3:00 p.m., Friday|Entire length
Avenue E|North|9:00 a.m. to 3:00 p.m., Wednesday|Entire length
Avenue E|South|9:00 a.m. to 3:00 p.m., Friday|Entire length
Avenue F|North|9:00 a.m. to 3:00 p.m., Wednesday|Entire length
Avenue F|South|9:00 a.m. to 3:00 p.m., Friday|Entire length
Barbara Court|Both|9:00 a.m. to 3:00 p.m., Tuesday|Entire court
Bell Avenue|North|9:00 a.m. to 3:00 p.m., Thursday|Oak Grove Avenue to Brookside Avenue
Bell Avenue|South|9:00 a.m. to 3:00 p.m., Tuesday|From Oak Grove Avenue to Brookside Avenue
Bernice Place|East|9:00 a.m. to 3:00 p.m., Wednesday|Entire length
Bernice Place|West|9:00 a.m. to 3:00 p.m., Monday|Entire length
Blueridge Road|East|9:00 a.m. to 3:00 p.m., Friday|Entire length
Blueridge Road|West|9:00 a.m. to 3:00 p.m., Wednesday|Entire length
Borig Place|East|9:00 a.m. to 10:00 a.m., Friday|Keasler Avenue to Hamilton Avenue  # Amended 11-12-1991 by Ord. No. 192-8
Borig Place|West|9:00 a.m. to 3:00 p.m., Tuesday|Keasler Avenue to Hamilton Avenue
Boyd Street|East|9:00 a.m. to 3:00 p.m., Tuesday|Entire length
Boyd Street|West|9:00 a.m. to 3:00 p.m., Thursday|Entire length
Branca Court|East|9:00 a.m. to 3:00 p.m., Friday|Entire length
Branca Court|West|9:00 a.m. to 3:00 p.m., Wednesday|Entire length
Brookside Avenue|East|9:00 a.m. to 3:00 p.m., Thursday|Entire length
Brookside Avenue|West|9:00 a.m. to 3:00 p.m., Tuesday|Entire length
Bruce Court|East|9:00 a.m. to 3:00 p.m., Tuesday|Entire length
Bruce Court|West|9:00 a.m. to 3:00 p.m., Thursday|Entire length
Bryant Place|North|9:00 a.m. to 3:00 p.m., Monday|Entire length
Bryant Place|South|9:00 a.m. to 3:00 p.m., Wednesday|Entire length
Burns Avenue|East|9:00 a.m. to 3:00 p.m., Wednesday|Entire length
Burns Avenue|West|9:00 a.m. to 3:00 p.m., Monday|Entire length
Calvin Avenue|East|9:00 a.m. to 3:00 p.m., Friday|Entire length
Calvin Avenue|West|9:00 a.m. to 3:00 p.m., Wednesday|Entire length
Central Avenue|North|9:00 a.m. to 3:00 p.m., Monday|Entire length
Central Avenue|South|9:00 a.m. to 3:00 p.m., Thursday|Entire length
Charles Court|Both|9:00 a.m. to 3:00 p.m., Friday|Entire court
Charles Street|North|9:00 a.m. to 3:00 p.m., Monday|Entire length
Charles Street|South|9:00 a.m. to 3:00 p.m., Wednesday|From Passaic Street to Westervelt Place and from Westminster Place to Harrison Avenue  # Amended 11-12-1991 by Ord. No. 192-8
Charles Street|South|9:00 a.m. to 10:00 a.m. Wednesday|From Westervelt Place to Westminster Place  # Added 11-12-1991 by Ord. No. 192-8
Charlton Avenue|North|9:00 a.m. to 3:00 p.m., Thursday|Entire length
Charlton Avenue|South|9:00 a.m. to 3:00 p.m., Tuesday|Entire length
Chestnut Street|North|9:00 a.m. to 3:00 p.m., Monday|Entire length
Chestnut Street|South|9:00 a.m. to 3:00 p.m., Thursday|Entire length
Christie Street|East|9:00 a.m. to 3:00 p.m., Tuesday|Entire length
Christie Street|West|9:00 a.m. to 3:00 p.m., Thursday|Entire length
Christopher Court|Both|9:00 a.m. to 3:00 p.m., Friday|Entire court
Christopher Street|East|9:00 a.m. to 3:00 p.m., Tuesday|Entire length
Christopher Street|West|9:00 a.m. to 3:00 p.m., Thursday|Entire length
Church Street|North|9:00 a.m. to 3:00 p.m., Thursday|From Massey Street to Hoehn Street
Church Street|South|9:00 a.m. to 3:00 p.m., Tuesday|Entire length
Clark Court|Both|9:00 a.m. to 3:00 p.m., Friday|Entire court
Clark Street|East|9:00 a.m. to 3:00 p.m., Tuesday|Entire length
Clark Street|West|9:00 a.m. to 3:00 p.m., Thursday|Entire length
Columbia Avenue|South|9:00 a.m. to 3:00 p.m., Friday|Entire length
Columbia Lane|North|All; except 9:00 a.m. to 3:00 p.m., Friday|From Main Street to Hancock Street
Columbia Lane|South|9:00 a.m. to 3:00 p.m., Friday|From Hancock Street to Mill Street
Columbia Lane|South|9:00 a.m. to 3:00 p.m., Friday|From Main Street to Hancock Street
Contant Avenue|North|All; except 9:00 a.m. to 3:00 p.m., Wednesday|From Westervelt Place to Corabelle Avenue
Contant Avenue|South|9:00 a.m. to 3:00 p.m., Wednesday|From Westervelt Place to Corabelle Avenue
Corabelle Avenue|East|9:00 a.m. to 3:00 p.m., Wednesday|Entire length
Corabelle Avenue|West|9:00 a.m. to 3:00 p.m., Monday|From First Street to Contant Avenue
Davis Drive|East|9:00 a.m. to 3:00 p.m., Tuesday|Entire length
Davis Drive|West|9:00 a.m. to 3:00 p.m., Thursday|Entire length
Davis Drive|West|All/All, except Tuesday, 9:00 a.m. to 3:00 p.m.|Between St. Joseph Boulevard and Union Street  # Added 12-19-2005 by Ord. No. 606-12
Dell Glen Avenue|East|9:00 a.m. to 3:00 p.m., Wednesday|From Arnot Street to Park Place
Dell Glen Avenue|West|9:00 a.m. to 3:00 p.m., Monday|Entire length
East Place|East|9:00 a.m. to 3:00 p.m., Monday|Entire length  # Added 4-15-1996 by Ord. No. 196-25
East Place|West|9:00 a.m. to 3:00 p.m., Thursday|Entire length  # Added 4-15-1996 by Ord. No. 196-25
East Place|West|4:00 p.m. to __, Monday to Friday|From Washington Street to James Street  # Added 3-16-1992 by Ord. No. 192-17
Eastgate Court|South|9:00 a.m. to 3:00 p.m., Thursday|Entire court
Edward Court|Both|9:00 a.m. to 3:00 p.m., Friday|Entire court
Farnham Avenue|East|9:00 a.m. to 3:00 p.m., Wednesday|Entire length
Farnham Avenue|West|9:00 a.m. to 3:00 p.m., Monday|Entire length
Ferndale Court|Both|9:00 a.m. to 3:00 p.m., Wednesday|Entire court
First Street|North|9:00 a.m. to 3:00 p.m., Monday|From Passaic Avenue to Corabelle Avenue
First Street|South|9:00 a.m. to 10:00 a.m. Wednesday|From Passaic Avenue to Harrison Avenue  # Added 11-12-1991 by Ord. No. 192-8
First Street|South|9:00 a.m. to 3:00 p.m., Wednesday|From Passaic Avenue to South Corabelle Avenue
Ford Street|East|9:00 a.m. to 3:00 p.m., Tuesday|Entire length
Ford Street|West|9:00 a.m. to 3:00 p.m., Thursday|Entire length
Frederick Street|North|9:00 a.m. to 3:00 p.m., Wednesday|From Passaic Avenue to Harrison Avenue  # Added 9-5-1985 by Ord. No. 85-24; amended 6-15-2021 by Ord. No. 2021-16
Garden Street|East|9:00 a.m. to 3:00 p.m., Tuesday|Entire length
Garden Street|West|9:00 a.m. to 3:00 p.m., Friday|Entire length
Garfield Avenue|East|9:00 a.m. to 3:00 p.m., Wednesday|Entire length
Garfield Avenue|West|9:00 a.m. to 3:00 p.m., Monday|Entire length
Garibaldi Avenue|South|9:00 a.m. to 12:00 p.m., Friday|Entire length  # Amended 8-15-2005 by Ord. No. 606-01
Grant Street|East|9:00 a.m. to 3:00 p.m., Friday|Entire length
Grant Street|West|9:00 a.m. to 3:00 p.m., Wednesday|Entire length
Green Court|East|All; except 9:00 a.m. to 3:00 p.m., Thursday|Entire length
Green Court|West|9:00 a.m. to 3:00 p.m., Thursday|Entire length
Greenlawn Drive|East|9:00 a.m. to 3:00 p.m., Friday|Entire length
Greenlawn Drive|West|9:00 a.m. to 3:00 p.m., Wednesday|Entire length
Grove Street|East|9:00 a.m. to 3:00 p.m., Monday|Entire length
Grove Street|West|9:00 a.m. to 3:00 p.m., Thursday|Entire length
Gunther Avenue|North|9:00 a.m. to 3:00 p.m., Wednesday|Entire length
Gunther Avenue|South|9:00 a.m. to 3:00 p.m., Friday|Entire length
Hamilton Avenue|North|9:00 a.m. to 3:00 p.m., Friday|Entire length
Hamilton Avenue|North|9:00 a.m. to 3:00 p.m., Tuesday|Entire length  # Added 8-9-2016 by Ord. No. 2016-18
Hamilton Avenue|South|9:00 a.m. to 3:00 p.m., Tuesday|Entire length
Hamilton Avenue|South|9:00 a.m. to 3:00 p.m., Friday|Entire length  # Added 8-9-2016 by Ord. No. 2016-18
Hancock Street|East|9:00 a.m. to 3:00 p.m., Friday|From Trudy Drive north to terminus
Hancock Street|West|9:00 a.m. to 3:00 p.m., Wednesday|From Trudy Drive north to terminus
Hansen Street|North|9:00 a.m. to 3:00 p.m., Wednesday|Entire length
Hansen Street|South|9:00 a.m. to 3:00 p.m., Friday|Entire length
Harrison Avenue|East|9:00 a.m. to 10:00 a.m., Monday|Entire length
Henry Street|North|9:00 a.m. to 3:00 p.m., Monday|Entire length
Henry Street|South|9:00 a.m. to 3:00 p.m., Thursday|Entire length
Hillcrest Avenue|East|9:00 a.m. to 3:00 p.m., Monday|Entire length
Hillcrest Avenue|West|9:00 a.m. to 3:00 p.m., Thursday|Entire length
Hillside Place|North|9:00 a.m. to 10:00 a.m. Monday|Entire length  # Added 11-12-1991 by Ord. No. 192-8
Hillside Place|South|9:00 a.m. to 10:00 a.m. Wednesday|Entire length  # Added 11-12-1991 by Ord. No. 192-8
Hoehn Street|East|9:00 a.m. to 3:00 p.m., Tuesday|From 125 feet north of Union Street to Church Street
Hoehn Street|West|All; except 9:00 a.m. to 3:00 p.m., Tuesday|From 125 feet north of Union Street to Church Street
Home Place|North|9:00 a.m. to 3:00 p.m., Monday|Entire length
Home Place|South|9:00 a.m. to 10:00 a.m., Wednesday|Entire length  # Amended 11-12-1991 by Ord. No. 192-8
Hope Street|East|9:00 a.m. to 3:00 p.m., Tuesday|Entire length
Hope Street|East|8:00 a.m. to 8:00 p.m., all days except for Thursday|Between the southerly sideline of Route No. 46 and the northerly sideline of Eastgate Court  # Added 9-9-1987 by Ord. No. 87-19
Hope Street|West|9:00 a.m. to 3:00 p.m., Thursday|Entire length
Howard Street|East|9:00 a.m. to 3:00 p.m., Tuesday|Entire length
Howard Street|West|9:00 a.m. to 3:00 p.m., Friday|Entire length
Hughes Street|North|9:00 a.m. to 3:00 p.m., Monday|Entire length
Hughes Street|South|9:00 a.m. to 3:00 p.m., Wednesday|Entire length
Hunter Street|North|9:00 a.m. to 3:00 p.m., Monday|From Summer Street to Woodside Avenue
Hunter Street|South|9:00 a.m. to 3:00 p.m., Thursday|From Lafayette Place to Woodside Avenue
Jackson Place|East|9:00 a.m. to 3:00 p.m., Monday|Entire length
Jackson Place|West|9:00 a.m. to 3:00 p.m., Thursday|Entire length
James Court|Both|9:00 a.m. to 3:00 p.m., Friday|Entire court
James Place|East|9:00 a.m. to 3:00 p.m., Tuesday|Entire length
James Place|West|9:00 a.m. to 3:00 p.m., Thursday|Entire length
James Place|West|All/All except Tuesday, 6:00 a.m. to 7:00 p.m.|Between St. Joseph Boulevard and Union Street  # Added 6-16-2003 by Ord. No. 303-19
James Street|North|9:00 a.m. to 3:00 p.m., Tuesday|From Prospect Street to Brookside Avenue
James Street|South|All; except 9:00 a.m. to 3:00 p.m., Tuesday|From Prospect Street to Brookside Avenue
James Street|South|9:00 a.m. to 3:00 p.m., Thursday|From St. Joseph Plaza to Prospect Street
Jefferson Street|East|9:00 a.m. to 3:00 p.m., Monday|Entire length
Jefferson Street|West|9:00 a.m. to 3:00 p.m., Thursday|Entire length
John Street|North|All; except 9:00 a.m. to 3:00 p.m., Tuesday|Entire length
John Street|South|9:00 a.m. to 3:00 p.m., Tuesday|Entire length
Keasler Avenue|North|9:00 a.m. to 3:00 p.m., Friday|Entire length
Keasler Avenue|South|9:00 a.m. to 3:00 p.m., Tuesday|Entire length
Kennedy Drive|North|9:00 a.m. to 3:00 p.m., Thursday|Entire length
Kennedy Drive|South|9:00 a.m. to 3:00 p.m., Tuesday|From Main Street to Victor Street
Kimmig Avenue|North|9:00 a.m. to 3:00 p.m., Tuesday|Entire length  # Added 8-9-2016 by Ord. No. 2016-18
Kimmig Avenue|North|9:00 a.m. to 3:00 p.m., Friday|Entire length
Kimmig Avenue|South|9:00 a.m. to 3:00 p.m., Tuesday|Entire length
Kimmig Avenue|South|9:00 a.m. to 3:00 p.m., Friday|Entire length  # Added 8-9-2016 by Ord. No. 2016-18
Kipp Avenue|North|9:00 a.m. to 3:00 p.m., Monday|Entire length
Kipp Avenue|South|9:00 a.m. to 3:00 p.m., Thursday|Entire length
Lafayette Place|East|9:00 a.m. to 3:00 p.m., Monday|Entire length
Lafayette Place|West|9:00 a.m. to 3:00 p.m., Thursday|Entire length
Lawrence Avenue|North|9:00 a.m. to 3:00 p.m., Thursday|Entire length
Lawrence Avenue|South|9:00 a.m. to 3:00 p.m., Tuesday|Entire length
Leo Place|East|9:00 a.m. to 3:00 p.m., Tuesday|Entire length
Leo Place|West|All; except 9:00 a.m. to 3:00 p.m., Tuesday|Entire length
Liberty Lane|East|4:00 p.m. to __, Monday to Friday|Entire length  # Added 3-16-1992 by Ord. No. 192-17; amended 9-21-1992 by Ord. No. 193-06
Liberty Lane|East|9:00 a.m. to 3:00 p.m., Monday|Between Washington Street and Liberty Street  # Added 4-15-1996 by Ord. No. 196-21
Liberty Lane|West|9:00 a.m. to 3:00 p.m., Thursday|Between Washington Street and Liberty Street  # Added 4-15-1996 by Ord. No. 196-21
Liberty Street|North|All; except 9:00 a.m. to 10:00 a.m., Tuesday|From Liberty Lane to Prospect Street  # Added 11-12-1991 by Ord. No. 192-8
Liberty Street|North|All; except 9:00 a.m. to 3:00 p.m., Tuesday|From Prospect Street east to terminus
Liberty Street|South|9:00 a.m. to 10:00 a.m., Tuesday|From Liberty Lane to Prospect Street  # Added 11-12-1991 by Ord. No. 192-8
Liberty Street|South|9:00 a.m. to 3:00 p.m., Tuesday|From Prospect Street east to terminus
Lincoln Place|North|9:00 a.m. to 3:00 p.m., Monday|Entire length
Lincoln Place|South|9:00 a.m. to 3:00 p.m., Thursday|Entire length
Linden Street|East|9:00 a.m. to 3:00 p.m., Tuesday|Entire length
Linden Street|West|9:00 a.m. to 3:00 p.m., Friday|Entire length
Logan Place|East|9:00 a.m. to 3:00 p.m., Monday|Entire length
Logan Place|West|9:00 a.m. to 3:00 p.m., Thursday|Entire length
Longvalley Road|East|9:00 a.m. to 3:00 p.m., Friday|Entire length
Longvalley Road|West|9:00 a.m. to 3:00 p.m., Wednesday|Entire length
Lorelei Terrace|East|9:00 a.m. to 3:00 p.m., Friday|Entire length
Lorelei Terrace|West|9:00 a.m. to 3:00 p.m., Wednesday|Entire length
Louis Street|East|All; except 9:00 a.m. to 3:00 p.m., Thursday|From 100 feet north of Union Street to St. Joseph Boulevard
Louis Street|West|9:00 a.m. to 3:00 p.m., Thursday|From 100 feet north of Union Street to St. Joseph Boulevard
Lucille Drive|East|9:00 a.m. to 3:00 p.m., Friday|Entire length
Lucille Drive|West|9:00 a.m. to 3:00 p.m., Wednesday|Entire length
MacArthur Avenue|North|9:00 a.m. to 3:00 p.m., Tuesday|Entire length
MacArthur Avenue|South|9:00 a.m. to 3:00 p.m., Friday|Entire length
Madison Street|East|9:00 a.m. to 3:00 p.m., Monday|Entire length
Madison Street|West|9:00 a.m. to 3:00 p.m., Thursday|Entire length
Marion Pepe Drive|East|9:00 a.m. to 3:00 p.m., Monday|From Terhune Avenue to Circle
Marion Pepe Drive|Inner Circle|9:00 a.m. to 3:00 p.m., Monday|Entire length
Marion Pepe Drive|Outer Circle|9:00 a.m. to 3:00 p.m., Thursday|Entire length
Marion Pepe Drive|West|9:00 a.m. to 3:00 p.m., Thursday|From Terhune Avenue to Circle
Marion Street|East|9:00 a.m. to 3:00 p.m., Tuesday|Entire length
Marion Street|West|9:00 a.m. to 3:00 p.m., Friday|Entire length
Mary Street|North|9:00 a.m. to 3:00 p.m., Monday|Entire length
Mary Street|South|9:00 a.m. to 3:00 p.m., Thursday|Entire length
Massey Street|East|9:00 a.m. to 3:00 p.m., Tuesday|From Union Street to a point 118 feet north of Union Street  # Added 11-17-2020 by Ord. No. 2020-24
Massey Street|East|9:00 a.m. to 3:00 p.m., Tuesday|From 118 feet north of Union Street to Church Street
Massey Street|West|9:00 a.m. to 3:00 p.m., Thursday|From Union Street to a point 140 feet north of Union Street  # Added 11-17-2020 by Ord. No. 2020-24
Massey Street|West|9:00 a.m. to 3:00 p.m., Thursday|From 140 feet north of Union Street to Church Street
McGuire Place|East|9:00 a.m. to 3:00 p.m., Tuesday|Entire length
McGuire Place|West|9:00 a.m. to 3:00 p.m., Friday|Entire length
McKinley Avenue|North|9:00 a.m. to 3:00 p.m., Monday|Entire length
McKinley Avenue|South|9:00 a.m. to 3:00 p.m., Thursday|Entire length
Mitchell Street|North|All; except 9:00 a.m. to 3:00 p.m., Tuesday|Entire length
Mitchell Street|South|9:00 a.m. to 3:00 p.m., Tuesday|Entire length
Money Street|East|9:00 a.m. to 3:00 p.m., Thursday|From Kennedy Drive to Sidney Street
Money Street|East|9:00 a.m. to 3:00 p.m., Tuesday|From Route 46 to John Street
Money Street|West|9:00 a.m. to 3:00 p.m., Tuesday|From Kennedy Drive to Sidney Street
Money Street|West|All; except 9:00 a.m. to 3:00 p.m., Tuesday|From Route 46 to John Street
Monroe Street|North|9:00 a.m. to 3:00 p.m., Monday|Entire length
Monroe Street|South|9:00 a.m. to 3:00 p.m., Thursday|Entire length
Myrtle Street|North|9:00 a.m. to 3:00 p.m., Wednesday|Entire length
Myrtle Street|South|9:00 a.m. to 3:00 p.m., Monday|Entire length
North Savoie Street|East|9:00 a.m. to 3:00 p.m., Tuesday|From MacArthur Avenue to Route 46  # Amended 3-21-2005 by Ord. No. 505-15
North Savoie Street|West|All; except 9:00 a.m. to 3:00 p.m., Thursday|From MacArthur Avenue to Route 46
North Savoie Street|West|9:00 a.m. to 3:00 p.m. Friday|From MacArthur Avenue to Route 46  # Added 3-21-2005 by Ord. No. 505-15
North Woodside Avenue|East|9:00 a.m. to 3:00 p.m., Tuesday|Entire length
North Woodside Avenue|West|9:00 a.m. to 3:00 p.m., Thursday|Entire length
Norwood Avenue|North|9:00 a.m. to 3:00 p.m., Monday|Entire length
Norwood Avenue|South|9:00 a.m. to 3:00 p.m., Thursday|Entire length
Oratio Place|East|9:00 a.m. to 3:00 p.m., Tuesday|Entire length
Oratio Place|West|9:00 a.m. to 3:00 p.m., Thursday|Entire length
Orchard Court|Both|9:00 a.m. to 3:00 p.m., Friday|Entire court
Orchard Street|East|9:00 a.m. to 3:00 p.m., Monday|Entire length
Orchard Street|West|9:00 a.m. to 3:00 p.m., Thursday|Entire length
Park Avenue|North/South|Monday, Tuesday, Thursday, Friday 9:00 a.m. to 3:00 p.m.|Entire length  # Amended 12-19-1994 by Ord. No. 195-17
Pasadena Avenue|North|9:00 a.m. to 3:00 p.m., Thursday|Entire length
Pasadena Avenue|South|9:00 a.m. to 3:00 p.m., Tuesday|Entire length
Passaic Avenue|East|9:00 a.m. to 10:00 a.m., Wednesday|From First Street to Frederick Street  # Added 11-12-1991 by Ord. No. 192-8
Passaic Avenue|West|9:00 a.m. to 10:00 a.m., Monday|From First Street to Frederick Street  # Added 11-12-1991 by Ord. No. 192-8
Paterson Avenue|North|9:00 a.m. to 3:00 p.m., Tuesday|Entire length
Paterson Avenue|South|9:00 a.m. to 3:00 p.m., Thursday|Entire length
Patton Street|North|9:00 a.m. to 3:00 p.m., Monday|Entire length
Patton Street|South|9:00 a.m. to 3:00 p.m., Thursday|Entire length
Pauline Terrace|West|9:00 a.m. to 3:00 p.m., Friday|From Columbia Avenue to Garibaldi Avenue
Pearl Court|Both|9:00 a.m. to 3:00 p.m., Friday|Entire length  # Amended 1-21-2020 by Ord. No. 2019-24
Pearl Court|West|9:00 a.m. to 3:00 p.m., Wednesday|Entire length
Pine Street|East|9:00 a.m. to 3:00 p.m., Tuesday|Entire length
Pine Street|West|All; except 9:00 a.m. to 3:00 p.m., Tuesday|Entire length
Prospect Street|East|9:00 a.m. to 3:00 p.m., Monday|From Liberty Street to Kipp Avenue
Putnam Street|East|9:00 a.m. to 3:00 p.m., Tuesday|Entire length
Putnam Street|West|8:00 a.m. to 4:00 p.m., except Saturday, Sunday, and holidays|From Outwater Lane to Hamilton Avenue
Putnam Street|West|9:00 a.m. to 3:00 p.m., Friday|Hamilton Avenue to Kimmig Avenue
Ragonese Street|East|9:00 a.m. to 3:00 p.m., Tuesday|Entire length
Ragonese Street|West|9:00 a.m. to 3:00 p.m., Thursday|Entire length
Redstone Lane|North|9:00 a.m. to 3:00 p.m., Wednesday|Entire length
Redstone Lane|South|9:00 a.m. to 3:00 p.m., Friday|Entire length
Richmond Street|North|9:00 a.m. to 3:00 p.m., Monday|Entire length
Richmond Street|South|9:00 a.m. to 3:00 p.m., Thursday|Entire length
River Street|East|9:00 a.m. to 3:00 p.m., Wednesday|Entire length
River Street|West|9:00 a.m. to 10:00 a.m., Monday|Entire length  # Amended 11-12-1991 by Ord. No. 192-8
Riverview Avenue|East|9:00 a.m. to 3:00 p.m., Friday|From Trudy Drive to Lucille Drive
Riverview Avenue|West|9:00 a.m. to 3:00 p.m., Wednesday|From Trudy Drive to Lucille Drive
Robert Court|East|9:00 a.m. to 3:00 p.m., Tuesday|Entire length
Robert Court|West|9:00 a.m. to 3:00 p.m., Thursday|Entire length
Roosevelt Avenue|East|9:00 a.m. to 3:00 p.m., Monday|Entire length
Roosevelt Avenue|West|9:00 a.m. to 3:00 p.m., Thursday|Entire length
Roosevelt Place|East|9:00 a.m. to 3:00 p.m., Tuesday|Entire length
Roosevelt Place|West|9:00 a.m. to 3:00 p.m., Thursday|Entire length
Roselle Avenue|East|9:00 a.m. to 3:00 p.m., Friday|Entire length
Roselle Avenue|West|9:00 a.m. to 3:00 p.m., Wednesday|Entire length
Savoie Street|East|9:00 a.m. to 3:00 p.m., Tuesday|Entire length
Savoie Street|West|9:00 a.m. to 3:00 p.m., Thursday|Entire length  # Amended 12-17-2019 by Ord. No. 2019-22
Shady Lane|East|9:00 a.m. to 3:00 p.m., Friday|Entire length
Shady Lane|West|9:00 a.m. to 3:00 p.m., Wednesday|Entire length
Sheridan Street|North|9:00 a.m. to 3:00 p.m., Monday|Entire length
Sheridan Street|South|9:00 a.m. to 3:00 p.m., Thursday|Entire length
Sherman Avenue|North|9:00 a.m. to 3:00 p.m., Friday|Entire length
Sherman Avenue|South|9:00 a.m. to 3:00 p.m., Tuesday|Entire length
Short Street|East|Friday 9:00 a.m. to 3:00 p.m.|From Garibaldi Avenue to MacArthur Avenue  # Added 5-20-2025 by Ord. No. 2025-04
Short Street|East|9:00 a.m. to 3:00 p.m., Tuesday|From MacArthur Avenue to Aida Court
Short Street|West|All; except Friday 9:00 a.m. to 3:00 p.m.|From Garibaldi Avenue to MacArthur Avenue  # Added 5-20-2025 by Ord. No. 2025-04
Short Street|West|9:00 a.m. to 3:00 p.m., Friday|From MacArthur Avenue to Aida Court
Sidney Street|North|7:00 a.m. to 5:00 p.m., Monday through Friday; 7:00 a.m. to 12:00 noon, Saturday; except holidays|From 50 feet east of Money Street, east for 100 feet
Sidney Street|North|All; except 9:00 a.m. to 3:00 p.m., Tuesday|From Main Street to Money Street
Sidney Street|South|9:00 a.m. to 3:00 p.m., Tuesday|Entire length
South Corabelle Avenue|East|9:00 a.m. to 3:00 p.m., Wednesday|Entire length
South Main Street|West|9:00 a.m. to 3:00 p.m., Thursday|From westerly prolongation of Lincoln Place to Terrace Avenue
South Savoie Street|East|9:00 a.m. to 3:00 p.m., Tuesday|Entire length
South Savoie Street|West|9:00 a.m. to 3:00 p.m., Thursday|Entire length
Spring Street|North|9:00 a.m. to 3:00 p.m., Monday|From Grove Street to Prospect Street
Spring Street|South|9:00 a.m. to 3:00 p.m., Thursday|Entire length
St. Joseph Boulevard|North|9:00 a.m. to 3:00 p.m., Thursday|Entire length
St. Joseph Boulevard|South|9:00 a.m. to 3:00 p.m., Tuesday|Entire length
St. Joseph's Plaza|East|9:00 a.m. to 3:00 p.m., Monday|Continuation of East Place entire length  # Added 4-15-1996 by Ord. No. 196-27
St. Joseph's Plaza|South|9:00 a.m. to 3:00 p.m., Thursday|Continuation of Spring Street entire length  # Added 4-15-1996 by Ord. No. 196-27
St. Joseph's Plaza|West|9:00 a.m. to 3:00 p.m., Thursday|Continuation of East Place entire length  # Added 4-15-1996 by Ord. No. 196-27
Staal Lane|North|9:00 a.m. to 3:00 p.m., Thursday|Entire length  # Added 4-15-1996 by Ord. No. 196-26
Staal Lane|South|9:00 a.m. to 3:00 p.m., Monday|Entire length  # Added 4-15-1996 by Ord. No. 196-26
Stokes Street|East|9:00 a.m. to 3:00 p.m., Tuesday|Entire length
Stokes Street|West|9:00 a.m. to 3:00 p.m., Thursday|Entire length
Summer Street|East|9:00 a.m. to 3:00 p.m., Monday|Entire length
Summer Street|West|9:00 a.m. to 3:00 p.m., Thursday|Entire length
Terrace Avenue|North|9:00 a.m. to 3:00 p.m., Monday|Entire length
Terrace Avenue|South|9:00 a.m. to 3:00 p.m., Thursday|Entire length
Trudy Drive|North|9:00 a.m. to 3:00 p.m., Wednesday|Entire length
Trudy Drive|South|9:00 a.m. to 3:00 p.m., Friday|Entire length
Union Street|North|9:00 a.m. to 3:00 p.m., Monday|Hoehn Street to Leo Place
Union Street|North|9:00 a.m. to 3:00 p.m., Monday|James Place to easterly prolongation of Prospect Street
Union Street|North|9:00 a.m. to 3:00 p.m., Tuesday|From 400 feet east of Main Street to Massey Street
Victor Street|East|9:00 a.m. to 3:00 p.m., Tuesday|From Garibaldi Avenue to Kennedy Drive
Victor Street|East|8:00 a.m. to 5:00 p.m., except Saturday, Sunday and holidays|From Kennedy Drive south to terminus
Victor Street|West|9:00 a.m. to 3:00 p.m., Thursday|Entire length
Vreeland Avenue|East|9:00 a.m. to 3:00 p.m., Tuesday|Entire length  # Added 4-15-1996 by Ord. No. 196-20
Vreeland Street|West|9:00 a.m. to 3:00 p.m., Friday|Entire length
Walnut Place|North|9:00 a.m. to 3:00 p.m., Monday|Entire length
Walnut Place|South|9:00 a.m. to 3:00 p.m., Wednesday|Entire length
Warren Street|North|9:00 a.m. to 3:00 p.m., Wednesday|Entire length
Warren Street|South|9:00 a.m. to 3:00 p.m., Monday|Entire length
Washington Street|North|All; except 9:00 a.m. to 3:00 p.m., Tuesday|Brookside Avenue to East Place
Washington Street|South|4:00 p.m. to _____, Monday to Friday|From the entrance to Acme East to Liberty Lane  # Added 3-16-1992 by Ord. No. 192-17
Washington Street|South|9:00 a.m. to 3:00 p.m., Tuesday|Brookside Avenue to East Place  # Amended 11-12-1991 by Ord. No. 192-8; 7-18-2005 by Ord. No. 505-26
Westervelt Place|East|9:00 a.m. to 3:00 p.m., Wednesday|Entire length
Westervelt Place|West|9:00 a.m. to 3:00 p.m., Monday|From Fredrick Street to Park Street and from First Street to Corabelle Avenue  # Amended 11-12-1991 by Ord. No. 192-8
Westervelt Place|West|9:00 a.m. to 10:00 a.m., _______|From Park Street to First Street  # Added 11-12-1991 by Ord. No. 192-8
Westminster Place|East|9:00 a.m. to 3:00 p.m., Wednesday|Hillside Place to Frederick Street
Westminster Place|West|9:00 a.m. to 3:00 p.m., Monday|Hillside Place to Frederick Street
White Oak Drive|North|9:00 a.m. to 3:00 p.m., Wednesday|Entire length
White Oak Drive|South|9:00 a.m. to 3:00 p.m., Friday|Entire length
Willard Street|North|9:00 a.m. to 3:00 p.m., Monday|Entire length
Willard Street|South|9:00 a.m. to 3:00 p.m., Wednesday|Entire length
Wilson Street|North|9:00 a.m. to 3:00 p.m., Wednesday|Entire length
Wilson Street|South|9:00 a.m. to 3:00 p.m., Friday|Entire length
Wisse Court|Both|9:00 a.m. to 3:00 p.m., Friday|Entire court
Wisse Street|East|9:00 a.m. to 3:00 p.m., Tuesday|Entire length
Wisse Street|West|9:00 a.m. to 3:00 p.m., Friday|Entire length
Woodside Avenue|East|9:00 a.m. to 3:00 p.m., Tuesday|From Lawrence Avenue to Paterson Avenue
Woodside Avenue|West|9:00 a.m. to 3:00 p.m., Thursday|Hunter Street to Kipp Avenue
Woodside Avenue|West|7:30 a.m. to 4:00 p.m., except Saturday, Sunday, and holidays|Kipp Avenue to Terrace Avenue
Woodside Avenue|West|9:00 a.m. to 3:00 p.m., Thursday|Union Street to Paterson Avenue
Yolanda Place|East|9:00 a.m. to 3:00 p.m., Friday|Entire length
Yolanda Place|West|9:00 a.m. to 3:00 p.m., Wednesday|Entire length
`;

// The Code's street names → the State layer's, where they differ (after norm()). Each is an assumption in the report.
export const STATE_NAME = {
  'Arlene Grove': 'Arlene Grv', 'First St': '1st St', 'Longvalley Rd': 'Long Valley Rd', 'St Joseph Blvd': 'Saint Joseph Blvd',
  'Fredrick St': 'Frederick St', 'Route 46': 'Us Hwy 46', 'Route No 46': 'Us Hwy 46',
  // the Code says Street, the State (and the street signs on the State's map) say Avenue
  'Jefferson St': 'Jefferson Ave', 'Madison St': 'Madison Ave', 'Marion St': 'Marion Ave',
  // the Code lists "Vreeland Avenue" (east side) and "Vreeland Street" (west side); the State has one Vreeland St
  'Vreeland Ave': 'Vreeland St',
  // a limit on James Street. The Code's own rows call St. Joseph's Plaza the "continuation of East Place"; the State
  // has no plaza, and East Pl meets James St at its end
  'St Joseph Plz': 'East Pl',
};

const TYPE = { STREET: 'St', AVENUE: 'Ave', ROAD: 'Rd', PLACE: 'Pl', TERRACE: 'Ter', COURT: 'Ct', BOULEVARD: 'Blvd', DRIVE: 'Dr', LANE: 'Ln',
  PARKWAY: 'Pkwy', HIGHWAY: 'Hwy', CIRCLE: 'Cir', SQUARE: 'Sq', PLAZA: 'Plz' };
const DIR = { NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W' };
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const SIDES = { north: 'N', south: 'S', east: 'E', west: 'W', both: 'B', 'north/south': 'B', 'inner circle': 'I', 'outer circle': 'O' };

/** "South Main Street" → "S Main St", "St. Joseph Boulevard" → "Saint Joseph Blvd": a Code name as the State writes it. */
export function norm(s) {
  const w = String(s).replace(/\[.*?\]/g, '').replace(/[.,]/g, ' ').trim().split(/\s+/);
  const name = titleCase(w.map((t, i) => {
    const u = t.toUpperCase();
    if (i > 0 && TYPE[u]) return TYPE[u];
    if (i === 0 && w.length > 2 && DIR[u]) return DIR[u];
    return t;
  }).join(' '));
  return STATE_NAME[name] || name;
}

const minutes = (t) => (typeof t === 'number' ? t * 60 : +t.split(':')[0] * 60 + +t.split(':')[1]);
/** "9:00 a.m. to 3:00 p.m., Monday" → { days: [1], from: 9, to: 15 }; null unless it is one plain window on named days. */
export function parseWhen(s) {
  const t = String(s || '').toLowerCase();
  if (/except|\ball\b|__|\band\b|;/.test(t)) return null;
  const days = /monday\s*(through|-|to)\s*friday/.test(t) ? [1, 2, 3, 4, 5] : DAYS.map((d, i) => (t.includes(d) ? i : -1)).filter((i) => i >= 0);
  const times = [...t.matchAll(/(\d{1,2}):(\d{2})\s*(a\.m\.|p\.m\.)/g)].map((m) => {
    const h = (+m[1] % 12) + (m[3] === 'p.m.' ? 12 : 0);
    return +m[2] ? `${h}:${m[2]}` : h;
  });
  if (!days.length || times.length !== 2 || minutes(times[0]) >= minutes(times[1])) return null;
  return { days, from: times[0], to: times[1] };
}

/** One end of a stretch: a cross street, a cross street and a distance from it, the street's own end, or its circle. */
export function parseLimit(s) {
  const t = String(s).trim().replace(/^(the|a point)\s+/i, '').replace(/^(north|south|east|west)erly\s+(prolongation|sideline)\s+of\s+/i, '');
  if (/^terminus$/i.test(t)) return { end: true };
  if (/^circle$/i.test(t)) return { circle: true };
  const m = t.match(/^(\d+)\s+feet\s+(north|south|east|west)\s+of\s+(.+)$/i);
  return m ? { name: norm(m[3]), feet: +m[1], dir: m[2][0].toUpperCase() } : { name: norm(t) };
}
/** "Entire length" → [{whole}]; "From X to Y", "X to Y", "Between X and Y", and two stretches joined by "and from". */
export function parseLocation(s) {
  const t = String(s || '').trim();
  if (/^entire (length|court)$/i.test(t)) return [{ whole: true }];
  const out = [];
  for (const piece of t.split(/\s+and\s+from\s+/i)) {
    const p = piece.replace(/^from\s+/i, '');
    const m = p.match(/^between\s+(.+?)\s+and\s+(.+)$/i) || p.match(/^(.+?)\s+to\s+(.+)$/i);
    if (!m) return null;
    const toEnd = /^terminus$/i.test(m[2].trim()) && m[1].match(/^(.+?)\s+(north|south|east|west)$/i);   // "X north to terminus"
    const from = parseLimit(toEnd ? toEnd[1] : m[1]), to = parseLimit(m[2]);
    if (toEnd) to.dir = toEnd[2][0].toUpperCase();
    out.push({ from, to });
  }
  return out;
}

export function parseRow(line) {
  const [body, note = ''] = line.split('  # ');
  const [street, side, when, location] = body.split('|').map((x) => x.trim());
  return { key: `${street}|${side}|${when}|${location}`, street: norm(street), side: SIDES[side.toLowerCase()] || null, when,
    time: parseWhen(when), stretches: parseLocation(location), note: note.trim() };
}
export const codeRows = () => CODE_ROWS.trim().split('\n').map(parseRow);

/** Why a row is not shown, or '' when it reads as a plain weekly window on a named side. */
export function whyNot(row) {
  const w = row.when.toLowerCase();
  if (/\ball\b/.test(w)) return 'reads "All" with an exception: the Code does not say what applies in the excepted hours';
  if (/__/.test(w)) return 'the hours or the day are blank in the Code';
  if (/except/.test(w)) return 'weekday hours with exceptions (weekends, holidays): not a weekly sweeping window';
  if (!row.time) return 'days or hours unreadable';
  if (!row.side) return 'the side is not one the build reads';
  if (!row.stretches) return 'location unreadable';
  return '';
}

// ---------- geometry (metres, paterson.mjs xy) -------------------------------------------------------

const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const DIRV = { N: [0, 1], S: [0, -1], E: [1, 0], W: [-1, 0] };
export const MEET = 6, NEAR = 120, CLEAR = 0.35;   // metres to count as meeting; metres for a nearest point; how square a side must face

export function distToLine(p, line) {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], ab = [line[i][0] - a[0], line[i][1] - a[1]], ap = [p[0] - a[0], p[1] - a[1]], L2 = dot(ab, ab);
    const t = L2 ? Math.max(0, Math.min(1, dot(ap, ab) / L2)) : 0;
    best = Math.min(best, Math.hypot(ap[0] - t * ab[0], ap[1] - t * ab[1]));
  }
  return best;
}
/** A street's own line: from its two farthest points. at(p) is how far along it a point lies, in metres. */
export function axisOf(segs) {
  const pts = segs.flatMap((s) => s.m);
  let o = pts[0], e = pts[0], len = 0;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    const d = Math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]);
    if (d > len) { o = pts[i]; e = pts[j]; len = d; }
  }
  const u = len ? [(e[0] - o[0]) / len, (e[1] - o[1]) / len] : [1, 0];
  const at = (p) => dot([p[0] - o[0], p[1] - o[1]], u);
  const ts = pts.map(at);
  return { u, at, lo: Math.min(...ts), hi: Math.max(...ts) };
}

/** Centerline features → segments: { i, p, id, name, c (lon/lat), m (metres), own: the sides in Lodi, curb }. */
export function segmentsOf(roads) {
  return roads.map((f, i) => {
    const p = f.properties, c = parts(f.geometry)[0];
    if (!c || c.length < 2) return null;
    return { i, p, id: String(p.RCL_NGUID || ''), name: streetName(p), c, m: c.map(xy), own: ['L', 'R'].filter((k) => p['INCMUNI_' + k] === LODI),
      curb: !NO_CURB.has(p.ROADCLASS) };
  }).filter(Boolean);
}
const group = (segs) => { const m = new Map(); for (const s of segs) { if (!m.has(s.name)) m.set(s.name, []); m.get(s.name).push(s); } return m; };

const ends = (s) => [s.m[0], s.m[s.m.length - 1]];
const near = (p, q, d) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= d;
/** The blocks of a street that form a ring (the circle at its end): those whose two ends stay joined without them. */
export function ringOf(segs) {
  return segs.filter((s) => {
    const [a, b] = ends(s), seen = new Set([s]), todo = [a];
    while (todo.length) {
      const p = todo.pop();
      if (near(p, b, MEET)) return true;
      for (const x of segs) {
        if (seen.has(x)) continue;
        const [c, d] = ends(x), far = near(p, c, MEET) ? d : near(p, d, MEET) ? c : null;
        if (far) { seen.add(x); todo.push(far); }
      }
    }
    return false;
  });
}
/** How many separate pieces a street's Lodi blocks are in (the same name in two places, or a gap in another town). */
export function piecesOf(segs) {
  const root = segs.map((_, i) => i), find = (i) => (root[i] === i ? i : (root[i] = find(root[i])));
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    if (ends(segs[i]).some((p) => distToLine(p, segs[j].m) < 40) || ends(segs[j]).some((p) => distToLine(p, segs[i].m) < 40)) root[find(i)] = find(j);
  }
  return new Set(segs.map((_, i) => find(i))).size;
}
const TYPES = new RegExp(` (${Object.values(TYPE).join('|')})$`);
const baseName = (n) => n.replace(TYPES, '');

/**
 * The street's blocks between two limits. `segs` are the street's Lodi blocks, `byName` every named line in the layer.
 * A limit is placed where its street meets this one (within MEET m); failing that at its nearest point (within NEAR m,
 * a "prolongation" or a highway the street stops short of); failing that where the one street with the same name and
 * another type meets it (the Code's "Passaic Street" on a street only Passaic Ave crosses). "Terminus" is the end the
 * Code points to ("north to terminus"), "Circle" the near end of the street's ring. A limit that cannot be placed
 * leaves the stretch out: it is never read as the street's end. A block is in when its middle lies between the limits.
 */
export function stretch(segs, { whole, from, to }, byName) {
  const notes = [];
  if (whole) return { segs, notes };
  const axis = axisOf(segs), ring = from.circle || to.circle ? ringOf(segs) : [];
  const hitsOf = (cross) => {
    const hits = [];
    for (const x of cross) for (const s of segs) {
      if (x === s) continue;
      for (const p of s.m) if (distToLine(p, x.m) <= MEET) hits.push(axis.at(p));
      for (const p of x.m) if (distToLine(p, s.m) <= MEET) hits.push(axis.at(p));
    }
    return hits;
  };
  // → metres along the street; null for an end the other limit decides (terminus, circle); undefined when it cannot be placed
  const place = (lim) => {
    if (lim.end || lim.circle) return null;
    const cross = byName.get(lim.name) || [];
    let hits = hitsOf(cross), t;
    if (!hits.length) {
      let best = null;
      for (const x of cross) for (const p of x.m) for (const s of segs) { const d = distToLine(p, s.m); if (!best || d < best.d) best = { d, t: axis.at(p) }; }
      if (best && best.d <= NEAR) {
        notes.push(`${lim.name} does not meet the street in the layer: placed at its nearest point (${Math.round(best.d)} m away)`);
        t = Math.max(axis.lo, Math.min(axis.hi, best.t));
      } else {
        const base = baseName(lim.name);
        const alike = [...byName.keys()].filter((n) => n !== lim.name && baseName(n) === base && hitsOf(byName.get(n)).length);
        if (alike.length !== 1) { notes.push(`${lim.name} ${cross.length ? 'is nowhere near the street' : 'is not'} in the State's layer`); return undefined; }
        notes.push(`${lim.name} is not on the street in the layer: read as ${alike[0]}, the one ${base} that meets it`);
        hits = hitsOf(byName.get(alike[0]));
      }
    }
    if (hits.length) {
      const spread = Math.max(...hits) - Math.min(...hits);
      if (spread > 60) notes.push(`${lim.name} meets the street in more than one place (${Math.round(spread)} m apart): the middle is used`);
      t = hits.reduce((a, b) => a + b, 0) / hits.length;
    }
    if (lim.feet) {
      const along = dot(axis.u, DIRV[lim.dir]);
      if (Math.abs(along) < CLEAR) notes.push(`"${lim.feet} feet ${lim.dir}" of ${lim.name}: the street does not run that way, distance not applied`);
      else { t += Math.sign(along) * lim.feet * 0.3048; notes.push(`${lim.feet} feet from ${lim.name} measured in a straight line`); }
    }
    return t;
  };
  const endOf = (lim, other) => {
    if (lim.circle) {
      if (!ring.length) { notes.push('the street has no circle in the State\'s layer'); return undefined; }
      return ring.flatMap((s) => s.m.map(axis.at)).reduce((a, b) => (Math.abs(b - other) < Math.abs(a - other) ? b : a));
    }
    const along = lim.dir ? dot(axis.u, DIRV[lim.dir]) : 0;
    if (Math.abs(along) < CLEAR) { notes.push('the Code does not say which end of the street the terminus is'); return undefined; }
    return along > 0 ? axis.hi : axis.lo;
  };
  let a = place(from), b = place(to);
  if (a === null && b != null) a = endOf(from, b);
  if (b === null && a != null) b = endOf(to, a);
  if (a == null || b == null) return { segs: [], notes, error: 'a limit could not be placed: the stretch is not shown' };
  const lo = Math.min(a, b) + 1, hi = Math.max(a, b) - 1;
  const inside = segs.filter((s) => { const t = axis.at(xy(midpoint(s.c))); return t > lo && t < hi && !ring.includes(s); });
  if (!inside.length) notes.push('no block has its middle inside the stretch (shorter than a block)');
  return { segs: inside, notes };
}

/** Which side of a block the Code's compass side is: by the block's own line, else (a bend) by the street's line. */
export function sideOf(seg, dir, axis) {
  const f = sideFacing(seg.c, dir);
  if (f.clear) return f.side;
  const facing = dot([-axis.u[1], axis.u[0]], DIRV[dir]);
  if (Math.abs(facing) <= CLEAR) return null;
  const a = seg.m[0], b = seg.m[seg.m.length - 1], withAxis = dot([b[0] - a[0], b[1] - a[1]], axis.u) >= 0;
  return (facing > 0) === withAxis ? 'L' : 'R';
}

/** On a ring, the side facing its middle ('I', the inner circle) or the other ('O'). */
export function ringSide(seg, ring, which) {
  const pts = ring.flatMap((s) => s.m), c = [pts.reduce((k, p) => k + p[0], 0) / pts.length, pts.reduce((k, p) => k + p[1], 0) / pts.length];
  const [a, b] = ends(seg), mid = xy(midpoint(seg.c));
  const leftIsInner = dot([-(b[1] - a[1]), b[0] - a[0]], [c[0] - mid[0], c[1] - mid[1]]) > 0;
  return leftIsInner === (which === 'I') ? 'L' : 'R';
}

const ruleKey = (r) => r.join('|');
/** Lay the rows onto the Lodi blocks. → { sides: Map(block id → Map(L|R → Map(rule key → rule))), rows: one record per row, inPieces: streets in separate pieces with an "entire length" row }. */
export function applyCode(rows, segs) {
  const byName = group(segs.filter((s) => isStreetName(s.name)));
  const bySt = group(segs.filter((s) => s.own.length && s.curb && isStreetName(s.name)));
  const sides = new Map(), out = [], inPieces = new Set();
  for (const row of rows) {
    const notes = new Set(), rec = { key: row.key, applied: 0, blocks: 0 };
    out.push(rec);
    const why = whyNot(row);
    if (why) { rec.setAside = why; continue; }
    const street = bySt.get(row.street);
    if (!street) { rec.notes = [`no ${row.street} coded to Lodi in the State's layer`]; continue; }
    const axis = axisOf(street), rules = row.time.days.map((dow) => [dow, row.time.from, row.time.to, WEEKS, MONTHS, FLAGS]);
    const seen = new Set(), ring = 'IO'.includes(row.side) ? ringOf(street) : null;
    if (ring && !ring.length) notes.add('the street has no circle in the State\'s layer');
    for (const st of row.stretches) {
      const r = stretch(street, st, byName);
      for (const n of r.notes) notes.add(n);
      if (r.error) notes.add(r.error);
      if (st.whole && !ring && piecesOf(street) > 1) { inPieces.add(row.street); notes.add('the street\'s Lodi blocks are in separate pieces: the row is on all of them'); }
      for (const s of ring ? r.segs.filter((x) => ring.includes(x)) : r.segs) {
        const want = row.side === 'B' ? ['L', 'R'] : [ring ? ringSide(s, ring, row.side) : sideOf(s, row.side, axis)];
        for (const side of want) {
          if (!side) { notes.add('a block runs the way the Code names the side: side unclear there, not shown'); continue; }
          if (!s.own.includes(side)) { if (row.side !== 'B') notes.add('on a block that side is in a neighboring town: not shown'); continue; }
          if (!sides.has(s.id)) sides.set(s.id, new Map());
          const m = sides.get(s.id);
          if (!m.has(side)) m.set(side, new Map());
          for (const rule of rules) m.get(side).set(ruleKey(rule), rule);
          rec.applied++; seen.add(s.id);
        }
      }
    }
    rec.blocks = seen.size;
    if (notes.size) rec.notes = [...notes];
  }
  return { sides, rows: out, inPieces: [...inPieces].sort() };
}

// ---------- fetching -------------------------------------------------------------------------------

async function getJSON(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'curb-lodi-build (+https://curb.guide)' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 200));
      return j;
    } catch (e) {
      if (i >= tries) throw new Error(`${url.slice(0, 120)}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
}
async function cached(name, fetcher, refresh) {
  const file = CACHE + name;
  if (!refresh && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const data = await fetcher();
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
  return data;
}
async function allFeatures(layer, fields, extra = {}) {
  const out = [];
  for (let offset = 0; ; offset += 2000) {
    const q = new URLSearchParams({ where: '1=1', outFields: fields.join(','), orderByFields: 'OBJECTID', resultOffset: offset, resultRecordCount: 2000,
      outSR: 4326, f: 'geojson', ...extra });
    const j = await getJSON(`${layer}/query?${q}`);
    out.push(...(j.features || []));
    if ((j.features || []).length < 2000) return out;
  }
}

// ---------- build ----------------------------------------------------------------------------------

function assertShape(roads, segs, rows) {
  if (roads.length < 1500) throw new Error(`only ${roads.length} centerlines around Lodi (expected about 2,200)`);
  const own = segs.filter((s) => s.own.length);
  if (own.length < 300) throw new Error(`only ${own.length} centerlines coded to Lodi (${LODI}): has the State's code changed?`);
  if (roads.some((f) => f.properties.EDITOR !== undefined)) throw new Error('the cache holds the EDITOR field: delete it and fetch again');
  if (rows.length < 300) throw new Error(`only ${rows.length} Code rows parsed`);
  const names = new Set(rows.map((r) => r.key));
  if (names.size !== rows.length) throw new Error('two Code rows are identical');
}

async function main() {
  const refresh = process.argv.includes('--refresh');
  const fetched = new Date().toISOString().slice(0, 10);
  const roads = await cached('road-centerlines.json', () => allFeatures(ROADS, ROAD_FIELDS,
    { geometry: ENVELOPE.join(','), geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects' }), refresh);
  const segs = segmentsOf(roads), rows = codeRows();
  assertShape(roads, segs, rows);
  log(`${roads.length} centerlines, ${segs.filter((s) => s.own.length).length} coded to Lodi, ${rows.length} Code rows`);

  const { sides, rows: recs, inPieces } = applyCode(rows, segs);
  const crossAt = crossStreets(roads.map((f) => (NO_CURB.has(f.properties.ROADCLASS) || !isStreetName(streetName(f.properties))
    ? { c: null, name: '' } : { c: parts(f.geometry)[0], name: streetName(f.properties) })));

  const skipped = new Map();
  const skip = (why, ex) => { const e = skipped.get(why) || { count: 0, examples: [] }; e.count++; if (e.examples.length < 5) e.examples.push(ex); skipped.set(why, e); };
  const checks = { cityLimitOneSide: 0, noCrossStreet: 0, noOddSide: 0, oneSideOnly: 0, twoDaysOneSide: 0, twoWindowsOneDay: 0 };
  const twoWindows = new Set();
  const blocks = [];
  for (const s of segs) {
    const m = sides.get(s.id);
    if (!m) continue;
    const ex = { id: s.id, street: s.name };
    if (lengthM(s.c) < MIN_BLOCK) { skip(`block under ${MIN_BLOCK} m (an intersection sliver)`, ex); continue; }
    if (!s.id) { skip('no RCL_NGUID (no stable id)', ex); continue; }
    const g = round6(s.c);
    if (g.length < 2) { skip('line collapses to one point at 6 decimals', ex); continue; }
    const a = crossAt(s.i, 0), b = crossAt(s.i, 1);
    if (!a && !b) checks.noCrossStreet++;
    if (s.own.length === 1) checks.cityLimitOneSide++;
    const n = houseRange(s.p), odd = oddSide(s.p);
    if (!odd) checks.noOddSide++;
    const d = [...m.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([side, rules]) => [side, compass4(s.c, side),
      [...rules.values()].sort((p, q) => p[0] - q[0] || minutes(p[1]) - minutes(q[1]))]);
    if (d.length === 1) checks.oneSideOnly++;
    if (d.some((x) => new Set(x[2].map((r) => r[0])).size > 1)) checks.twoDaysOneSide++;
    if (d.some((x) => new Set(x[2].map((r) => r[0])).size < x[2].length)) { checks.twoWindowsOneDay++; twoWindows.add(s.name); }
    blocks.push({ c: s.id, s: s.name, l: a && b && a !== b ? `${a} - ${b}` : a || b, ...(n ? { n } : {}), ...(odd ? { o: odd } : {}), g, d });
  }
  const ids = new Set(blocks.map((b) => b.c));
  if (ids.size !== blocks.length) throw new Error('two blocks share an id');
  blocks.sort((x, y) => x.s.localeCompare(y.s) || x.l.localeCompare(y.l) || x.c.localeCompare(y.c));
  const nSides = blocks.reduce((k, b) => k + b.d.length, 0), nRules = blocks.reduce((k, b) => k + b.d.reduce((j, x) => j + x[2].length, 0), 0);
  if (blocks.length < 200) throw new Error(`only ${blocks.length} blocks placed`);

  let W = 180, S = 90, E = -180, N = -90;
  for (const b of blocks) for (const [lo, la] of b.g) { W = Math.min(W, lo); E = Math.max(E, lo); S = Math.min(S, la); N = Math.max(N, la); }
  const r4 = (v) => Math.round(v * 1e4) / 1e4, pad = 0.004;

  const sources = [
    { name: 'Code of the Borough of Lodi, Chapter 560, § 560-38, Schedule II: No Parking Certain Hours (streets, sides, days and hours)',
      url: CODE_URL, license: 'Municipal code (public law), transcribed', fetched: CODE_READ },
    { name: 'Road Centerlines of NJ, NG9-1-1 (NJ Office of GIS; block lines, names, address ranges)',
      url: ROADS, license: 'NJOGIS conditions of use (njgin, "as is"); acknowledgement of NJOGIS requested', fetched },
  ];
  const city = {
    id: 'lodi', name: 'Lodi', region: 'New Jersey', tz: TZ,
    center: [r4((S + N) / 2), r4((W + E) / 2)], zoom: 15, bounds: [[r4(S - pad), r4(W - pad)], [r4(N + pad), r4(E + pad)]],
    holidays: {}, holidayRule: 'all',
    fine: 'up to $50', tow: 'no', fineSource: CODE_URL,
    agency: 'Borough of Lodi', scheduleUrl: CODE_URL, sources,
    words: {
      rule: 'No parking on the side of the street the Borough\'s schedule names during its street sweeping hours: on most blocks one day a week, 9 AM to 3 PM, on some for one hour.',
      afterpass: 'Each side has its own day, and the sign on your side wins. A fine of up to $50. The Code calls the schedule off when the Borough\'s sweepers are not running.',
      dataNotes: 'Days and hours come from the Borough of Lodi\'s Code (section 560-38, Schedule II: No Parking Certain Hours, read November 2026), laid row by row onto the State\'s street centerlines. The Code names each stretch in words, so where a rule starts or ends partway down a block the map shows the whole block or none of it. Sides the Code restricts in other ways (all day with an exception, school or business hours) are not shown, and the Code names no holidays.',
    },
  };

  const setAside = recs.filter((r) => r.setAside).map((r) => ({ key: r.key, why: r.setAside }));
  const notApplied = recs.filter((r) => !r.setAside && !r.applied).map((r) => ({ key: r.key, notes: r.notes || [] }));
  const withNotes = recs.filter((r) => r.applied && r.notes).map((r) => ({ key: r.key, blocks: r.blocks, notes: r.notes }));
  const report = {
    generated: fetched,
    inputs: { codeRows: rows.length, codeRead: CODE_READ, centerlines: roads.length, centerlinesInLodi: segs.filter((s) => s.own.length).length },
    output: { blocks: blocks.length, sides: nSides, rules: nRules, sizeBytes: 0 },
    season: { from: null, to: null, note: 'The Code gives no season: the schedule is shown all year.' },
    skipped: Object.fromEntries(skipped),
    checks,
    codeRows: { applied: recs.filter((r) => r.applied).length, setAside, notApplied, notes: withNotes },
    assumptions: [
      'Schedule II (§ 560-38) is the street sweeping schedule: its paragraph C suspends it "when the street sweepers of the Borough of Lodi are not operable".',
      'A row applies every week, all year: the Code gives no season, no week of the month and no holiday.',
      'A stretch covers every block whose middle lies between its two limits. Distances in feet are measured in a straight line from the cross street; a stretch shorter than a block is not shown.',
      'Where the Code and the State spell a street differently, the State\'s name is used: ' + Object.entries(STATE_NAME).map(([k, v]) => `${k} = ${v}`).join(', ') + '.',
      'Jefferson, Madison and Marion "Street" in the Code are the State\'s Jefferson, Madison and Marion Avenue; "Vreeland Avenue" (east side) and "Vreeland Street" (west side) are the State\'s one Vreeland St.',
      'On James Street, "St. Joseph Plaza" is read as East Place: the Code\'s own rows call the plaza the continuation of East Place, and the State has no plaza.',
      'A limit the State does not have on that street is read as the one street with the same name and another type that crosses it (each case is in codeRows.notes); with none, or more than one, the stretch is not shown.',
      'Marion Pepe Drive: "Inner Circle" is the curb facing the middle of the loop, "Outer Circle" the other; the East and West rows "From Terhune Avenue to Circle" are the straight block before the loop.',
      'On a street along the Borough line, only the side coded to Lodi gets the rule.',
    ],
    unverified: [
      'No block has been checked against the posted signs.',
      'Towing: Article II names a fine and no tow; shown as no towing.',
      'Holidays: none are named in the Code, so none are listed and nothing is skipped on a holiday.',
      'The 1965 Article I (§ 560-24, "Schedule 10: Alternate Side of Street Parking") lists about 40 streets on weekdays 8 AM to 5 PM with no side: not shown; it may be superseded by Schedule II.',
      'Rows the build could not place are listed under codeRows.notApplied; rows it set aside under codeRows.setAside.',
      ...(inPieces.length ? [`Streets whose Lodi blocks are in separate pieces, where an "Entire length" row is on every piece: ${inPieces.join(', ')}.`] : []),
      ...(twoWindows.size ? [`A side with two windows on one day, from two rows that overlap (both are shown): ${[...twoWindows].sort().join(', ')}.`] : []),
    ],
    questionsForCity: [
      'Is Schedule II (§ 560-38) the schedule the sweepers and the signs follow today? Is there a published map or list besides the Code?',
      'What do the rows that read "All; except <day and hours>" mean on the street: no parking at all times except then, or the reverse?',
      'Which holidays suspend the schedule, and is it suspended in winter or for snow?',
      'Is § 560-24 (Schedule 10, alternate side parking, 1965) still enforced?',
      'Three rows have blank hours or days (East Place, Liberty Lane, Washington Street south side; Westervelt Place west side): what do the signs say?',
      'Are Jefferson, Madison and Marion "Street" in the schedule the avenues of the same names? Is South Savoie Street today\'s Savoie Street?',
      'Can a car be towed for a street sweeping violation?',
      'First Street, south side: one row says Wednesday 9 to 10 AM from Passaic Avenue to Harrison Avenue, another Wednesday 9 AM to 3 PM from Passaic Avenue to South Corabelle Avenue. Which is posted?',
      'Putnam Street, west side: the Friday row runs "Hamilton Avenue to Kimmig Avenue". Where is that stretch? And James Street, south side, runs "From St. Joseph Plaza": is that the corner of East Place?',
      'Marion Pepe Drive: is the "Inner Circle" the curb around the island of the loop?',
    ],
  };

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(OUT + 'segments.json', JSON.stringify({
    _meta: { city: 'lodi', time_zone: TZ, generated: fetched, sources, blocks: blocks.length, sides: nSides,
      format: 'b[] = {c: State centerline id (RCL_NGUID), s: street, l: cross streets, n: [lowest, highest house number], o: side with the odd numbers, '
        + 'g: centerline [[lng,lat]] first point to last, d: [[side L|R, North|South|East|West as the Code names it, rules]]}; '
        + 'rule = [day 0 Sun..6 Sat, from, to (hour or "h:mm"), weeks bitmask (31 = every week), months bitmask (0 = all year), flags (1 = not stopped by a holiday)]' },
    b: blocks,
  }));
  fs.writeFileSync(OUT + 'city.json', JSON.stringify(city, null, 1) + '\n');
  report.output.sizeBytes = fs.statSync(OUT + 'segments.json').size;
  fs.writeFileSync(OUT + 'report.json', JSON.stringify(report, null, 1) + '\n');
  log(`${blocks.length} blocks, ${nSides} sides, ${nRules} rules; rows applied ${report.codeRows.applied}, set aside ${setAside.length}, not placed ${notApplied.length}, with notes ${withNotes.length}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
