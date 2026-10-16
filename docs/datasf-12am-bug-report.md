# Bug report to DataSF: the 12 AM hour in the parking citations feed

Sent Oct 11, 2026 from viziomas@gmail.com to support@datasf.org (the Contact Us address on data.sf.gov; the
dataset page has no owner form). DataSF replied Oct 15, 2026 that they are investigating. Until they fix it,
CURB corrects the hour (scripts/midnight-hour.mjs) and stops on any day the feed already has right.


---

Subject: Parking citations dataset (ab4h-6ztd): wrong hour for tickets issued 12:00 to 12:59 AM

Hello,

I build CURB (curb.guide), a free San Francisco street parking map that uses the SFMTA Parking Citations & Fines dataset. I found a problem with citation_issued_datetime: every citation issued between 12:00 and 12:59 AM has the wrong hour. The hour becomes the first digit of the minutes, so a ticket issued at 12:24 AM shows as 2:24 AM, and one issued at 12:05 AM shows as 5:05 AM. The date and the minutes are right.

For example, citation 2000985394 (April 29, 2026) shows 1:13 AM in the dataset, while SFMTA's own records show 12:13 AM.

I checked this against street cleaning citations SFMTA sent me through public records request 26-5453 (January 2024 to June 2026). Of the 50,464 citations from the 12 AM hour that appear in both, 50,447 have the wrong hour in the dataset, all with this same pattern. That's why the dataset shows only 25 street cleaning citations in the 12 AM hour since 2024.

It looks like the time is stored as a number (24 for 12:24 AM) and the hour is read from its first digit. Could you check the step that builds citation_issued_datetime?

I'm happy to share the list of citation numbers I compared.

Thank you,
Alejandro Vizio
curb.guide
