# Security Policy

CURB stores almost nothing — no accounts, no personal data. The only stored state
is Web Push subscriptions (endpoint URL + keys + a parked-spot location chosen by
the user) in Upstash Redis, written by `api/save-subscription.js` and read by the
notification cron.

## Reporting a vulnerability

Please use [GitHub private vulnerability reporting](https://github.com/alevizio/curb/security/advisories/new)
— don't open a public issue for security problems.

Most interesting surface area:

- `api/save-subscription.js` — input validation, the push-endpoint host allowlist
- `api/send-notifications.js` — `CRON_SECRET` bearer auth, subscription handling
- `api/block.js` — server-rendered share pages (injection via block data)
- The service worker (`sw.js`) and notification payload handling

Out of scope: the public DataSF datasets themselves, and rate limits on free-tier
infrastructure.

You can expect an acknowledgment within a few days. There's no bounty — this is a
free, no-revenue civic project — but you'll be credited in the fix commit if you
want to be.
