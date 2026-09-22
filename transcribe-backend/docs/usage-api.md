# Voice Agent Usage API

Read how many minutes the voice agent has spent on calls for each business — this month so far, and
last month's final total. Ask for every business at once, or for one business by its `userId`.
Read-only JSON over HTTPS, authenticated with an API key.

| | |
| --- | --- |
| Base URL | `https://transcribe-app-backend.vercel.app` |
| Authentication | `Authorization: Bearer ak_…` |
| Your key can read | Every business, all at once or one at a time |
| Access | Read-only; no expiry until revoked |

## Before you start

1. **Get an API key from TecAce.** An administrator creates one for your integration (dashboard:
   Settings → API keys) and sends it to you. It starts with `ak_`, reads every business, and is shown to
   them only once — if it's lost, ask for a new one.
2. **Store it as a server-side secret**, for example `USAGE_API_KEY` in your server's environment or
   secret manager. Every example below reads it from there. Never put it in browser code, a mobile app,
   or a file committed to git.
3. **Check you can reach the service** from the server that will call it:

   ```bash
   curl -sS https://transcribe-app-backend.vercel.app/health
   # {"status":"ok","uptime":5231.4}
   ```

4. **Running separate staging and production systems?** Ask for two keys, one per environment. They're
   independent secrets — either can be revoked without touching the other, and TecAce can tell them apart
   by their "last used" time. Both read the same live data: a staging key sees real customer numbers, the
   same as production, so treat it with the same care.

Send the key on every usage request, in the `Authorization` header. Always use HTTPS, and never put the
key in a URL or query string — URLs end up in logs.

## Endpoints at a glance

These are the only requests available to your integration.

| Request | Key | Returns |
| --- | --- | --- |
| `GET /usage/minutes` | Required | Every business, busiest this month first. Use it to find each business's `userId`, or to report on all of them. |
| `GET /usage/minutes?userId=<id>` | Required | Just that business's minutes. |
| `GET /usage/minutes?userId=<id>&from=<iso>&to=<iso>` | Required | That business's minutes, and its totals between two instants. |
| `GET /usage/minutes?userId=unassigned` | Required | Calls on phone numbers no business owns yet. Most integrations can ignore this. |
| `GET /health` | None | Whether the service is up. Says nothing about your key. |

## Get one business's minutes

Businesses are identified by `userId` — a permanent id, unlike the business name, which can be edited.
You look each id up once, store it, and then ask for that business directly.

### 1. Find the business's `userId`

Request every business and match the one you want by `businessName` (or the owner's `email`).

```bash
curl -sS https://transcribe-app-backend.vercel.app/usage/minutes \
  -H "Authorization: Bearer $USAGE_API_KEY"
```

Response (`200`, shortened):

```json
{
  "timezone": "America/Los_Angeles",
  "minutes": [
    { "userId": "3f1c9a2e-5b7d-4c1a-9e0f-2d6b8a4c7e11", "businessName": "Olympus Spa", "…": "…" },
    { "userId": "8a2d4f60-1c3e-4b7a-a5d9-6e0b2c8f1d34", "businessName": "Bellevue Dental", "…": "…" },
    { "userId": null, "businessName": null, "…": "…" }
  ]
}
```

Store the id against your own record for that business — here, Olympus Spa is
`3f1c9a2e-5b7d-4c1a-9e0f-2d6b8a4c7e11`. The entry with a `null` `userId` is the unassigned bucket, not a
business; skip it.

### 2. Request that business

Add its id as `?userId=`. From now on this is the only call you need for it.

```bash
curl -sS "https://transcribe-app-backend.vercel.app/usage/minutes?userId=3f1c9a2e-5b7d-4c1a-9e0f-2d6b8a4c7e11" \
  -H "Authorization: Bearer $USAGE_API_KEY"
```

Response (`200`):

```json
{
  "timezone": "America/Los_Angeles",
  "minutes": [
    {
      "userId": "3f1c9a2e-5b7d-4c1a-9e0f-2d6b8a4c7e11",
      "email": "owner@olympusspa.com",
      "name": "Sam Park",
      "businessName": "Olympus Spa",
      "currentMonth": "2026-09",
      "currentSeconds": 9000,
      "currentMinutes": 150,
      "previousMonth": "2026-08",
      "previousSeconds": 4230,
      "previousMinutes": 70.5,
      "updatedAt": "2026-09-15T18:04:11.284Z"
    }
  ]
}
```

`minutes` is still a list, holding exactly this one business. A business that hasn't had a call yet comes
back the same way, with zeroes. An id that isn't a business gets `404` `business_not_found`.

### 3. Read the numbers

| You want | Read | In the example |
| --- | --- | --- |
| This month so far, for billing or maths | `currentSeconds` | 9000 seconds in 2026-09 |
| This month so far, to show a person | `currentMinutes` | 150 minutes |
| Last month's final total | `previousSeconds` / `previousMinutes` | 4230 seconds (70.5 minutes) in 2026-08 |
| Which month each total is for | `currentMonth` / `previousMonth` | 2026-09 / 2026-08 |
| When a call last added to the total | `updatedAt` | 2026-09-15T18:04:11Z |

Months run midnight to midnight in `timezone`. On the 1st, this month's total moves to `previousSeconds`
and `currentSeconds` starts again at zero — so to bill a finished month, read `previousSeconds` any time
after the 1st and check `previousMonth` is the month you're billing.

## Usage between two dates

For anything other than "this month" or "last month" — a custom billing cycle, a year-to-date report,
reconciling a single day — add `from` and `to` to either request from the section above (all businesses,
or one by `userId`).

- **`from` is inclusive, `to` is exclusive.** Back-to-back ranges neither overlap nor leave a gap: if one
  request ends `&to=2026-09-01T07:00:00Z` and the next begins `&from=2026-09-01T07:00:00Z`, every call is
  counted exactly once between them.
- **Both are ISO 8601 instants, with an offset or `Z`** — for example `2026-09-01T00:00:00-07:00` or
  `2026-09-01T07:00:00Z` (the same instant). A plain date like `2026-09-01` is refused: without a timezone
  it means a different moment depending on where it's read, and a usage boundary that moves with the
  reader can't be reconciled. Send both parameters, or neither — one without the other is an error.
- **A call counts wholly in the period its start falls in.** A call is never split across two ranges, even
  one that runs past `to`.

Add both parameters to either request:

```bash
curl -sS "https://transcribe-app-backend.vercel.app/usage/minutes?userId=3f1c9a2e-5b7d-4c1a-9e0f-2d6b8a4c7e11&from=2026-08-15T07:00:00Z&to=2026-09-15T07:00:00Z" \
  -H "Authorization: Bearer $USAGE_API_KEY"
```

Response (`200`):

```json
{
  "timezone": "America/Los_Angeles",
  "from": "2026-08-15T07:00:00.000Z",
  "to": "2026-09-15T07:00:00.000Z",
  "settled": true,
  "settleSeconds": 3600,
  "coverageFrom": "2026-07-01T00:00:00.000Z",
  "minutes": [
    {
      "userId": "3f1c9a2e-5b7d-4c1a-9e0f-2d6b8a4c7e11",
      "email": "owner@olympusspa.com",
      "name": "Sam Park",
      "businessName": "Olympus Spa",
      "currentMonth": "2026-09",
      "currentSeconds": 9000,
      "currentMinutes": 150,
      "previousMonth": "2026-08",
      "previousSeconds": 4230,
      "previousMinutes": 70.5,
      "updatedAt": "2026-09-15T18:04:11.284Z",
      "periodSeconds": 5424,
      "periodMinutes": 90.4,
      "periodCalls": 37
    }
  ]
}
```

`from` and `to` are echoed back exactly as the server understood them — always normalized to UTC (`Z`) with
millisecond precision, regardless of the offset you sent. `periodSeconds`, `periodMinutes` and `periodCalls`
are added to every entry in `minutes` (a business with no calls in the window still appears, at zero — it
isn't dropped from the list). `settled`, `settleSeconds` and `coverageFrom` are explained below.

**Seconds and minutes, side by side.** `periodSeconds` is the exact total, the same way `currentSeconds` is
— use it for billing and any calculation. `periodMinutes` is the same figure rounded to one decimal, the
same way `currentMinutes` is — for display. This API is read in minutes throughout, so `periodMinutes` is
there for consistency with the monthly fields, but `periodSeconds` is exact and there's no rounding to
account for.

**A range over a calendar month won't always match `currentMinutes`/`previousMinutes` for that month, by
design** — two reasons:

1. **Different clocks.** The monthly counters bucket a call by when the agent *reported* it, which happens
   as the call ends; a ranged query buckets a call by when it *started* (see above). A call that starts at
   23:57 on the last day of the month and ends at 00:03 the next day is reported in the new month, so it
   lands in `currentSeconds` for that new month — but a range would count it in the period containing
   23:57, the period before.
2. **Calendar months are in `timezone`; a range is in absolute instants.** `currentMonth`/`previousMonth`
   are calendar months in the business's timezone (`timezone` in the response, `America/Los_Angeles` unless
   TecAce has set otherwise) — not UTC. To ask for the same span as a calendar month as a range, convert
   that month's boundaries out of `timezone` yourself. For example, September 2026 in
   `America/Los_Angeles` (UTC−7 all month; daylight saving doesn't end until November) is:

   ```
   from=2026-09-01T07:00:00Z   (2026-09-01T00:00:00-07:00)
   to=2026-10-01T07:00:00Z     (2026-10-01T00:00:00-07:00)
   ```

   Using UTC midnight instead (`2026-09-01T00:00:00Z` to `2026-10-01T00:00:00Z`) asks for a window shifted
   seven hours from what "September" means in the business's own timezone.

If you need a range's total to reconcile with a monthly figure, expect small, explainable differences —
don't treat them as a bug in either field.

### When a total stops changing

`settled` is `false` until `settleSeconds` after `to` has passed — `3600` (one hour) by default. A call is
only reported to this API once it ends, so a call that started before `to` may still be in progress when
the period closes, and its minutes haven't arrived yet. Until `settled` is `true`, `periodSeconds`,
`periodMinutes` and `periodCalls` for that range can still rise. Poll again after `settleSeconds` has
passed `to` for a number that won't move again.

`settleSeconds` is returned on every ranged response so you don't have to hard-code it — TecAce can change
the window without breaking your integration.

`settled: true` assumes no call in the window runs longer than `settleSeconds`; calls up to 24 hours long
are accepted, so on rare, unusually long calls a total can still rise after `settled` first reads `true`.

### How far back the data goes

`coverageFrom` is the earliest call this API has any record of (`null` if there are none yet). A range that
falls entirely before `coverageFrom` reads as zero because nothing was recorded that far back, not because
nothing happened — don't treat it as a confident answer. For periods before `coverageFrom`, use the
monthly totals instead (`currentSeconds`/`previousSeconds` from the section above), which aren't affected
by this limit.

## Complete example

A small client you can drop into your server: one function to list businesses and their ids, one to fetch
a single business's minutes, with the error handling from [Errors](#errors-and-what-to-do) built in.

### Node.js

```js
// usageApi.js — Node 18+ (built-in fetch). Run on your server, never in a browser.
const BASE_URL = "https://transcribe-app-backend.vercel.app";

async function callUsageApi(path) {
  const res = await fetch(BASE_URL + path, {
    headers: { Authorization: `Bearer ${process.env.USAGE_API_KEY}` },
    signal: AbortSignal.timeout(10_000),
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok) return body;
  if (res.status === 401) throw new Error(`Usage API rejected the key (${body.error}). Don't retry.`);
  if (res.status === 404) throw new Error(`No business has that userId (${body.error}). Don't retry.`);
  throw new Error(`Usage API returned ${res.status}. Retry later with backoff.`);
}

// Every business and its userId — run once, then store the ids.
export async function listBusinesses() {
  const { minutes } = await callUsageApi("/usage/minutes");
  return minutes
    .filter((b) => b.userId !== null) // skip the unassigned bucket
    .map((b) => ({ userId: b.userId, businessName: b.businessName, email: b.email }));
}

// One business's minutes, this month and last.
export async function getBusinessMinutes(userId) {
  const path = `/usage/minutes?userId=${encodeURIComponent(userId)}`;
  const { timezone, minutes: [b] } = await callUsageApi(path);
  return {
    userId: b.userId,
    businessName: b.businessName,
    timezone,
    thisMonth: { month: b.currentMonth, seconds: b.currentSeconds, minutes: b.currentMinutes },
    lastMonth: { month: b.previousMonth, seconds: b.previousSeconds, minutes: b.previousMinutes },
  };
}

// Usage
const spa = await getBusinessMinutes("3f1c9a2e-5b7d-4c1a-9e0f-2d6b8a4c7e11");
console.log(`${spa.businessName}: ${spa.thisMonth.minutes} min in ${spa.thisMonth.month}`);
// Olympus Spa: 150 min in 2026-09
```

### Python

```python
# usage_api.py — Python 3.8+, pip install requests. Run on your server.
import os
import requests

BASE_URL = "https://transcribe-app-backend.vercel.app"


def call_usage_api(params=None):
    resp = requests.get(
        f"{BASE_URL}/usage/minutes",
        params=params,
        headers={"Authorization": f"Bearer {os.environ['USAGE_API_KEY']}"},
        timeout=10,
    )
    if resp.ok:
        return resp.json()
    error = resp.json().get("error") if resp.headers.get("content-type", "").startswith("application/json") else None
    if resp.status_code == 401:
        raise RuntimeError(f"Usage API rejected the key ({error}). Don't retry.")
    if resp.status_code == 404:
        raise LookupError(f"No business has that userId ({error}). Don't retry.")
    raise RuntimeError(f"Usage API returned {resp.status_code}. Retry later with backoff.")


def list_businesses():
    """Every business and its userId — run once, then store the ids."""
    return [
        {"userId": b["userId"], "businessName": b["businessName"], "email": b["email"]}
        for b in call_usage_api()["minutes"]
        if b["userId"] is not None  # skip the unassigned bucket
    ]


def get_business_minutes(user_id):
    """One business's minutes, this month and last."""
    data = call_usage_api({"userId": user_id})
    b = data["minutes"][0]
    return {
        "userId": b["userId"],
        "businessName": b["businessName"],
        "timezone": data["timezone"],
        "thisMonth": {"month": b["currentMonth"], "seconds": b["currentSeconds"], "minutes": b["currentMinutes"]},
        "lastMonth": {"month": b["previousMonth"], "seconds": b["previousSeconds"], "minutes": b["previousMinutes"]},
    }


spa = get_business_minutes("3f1c9a2e-5b7d-4c1a-9e0f-2d6b8a4c7e11")
print(f"{spa['businessName']}: {spa['thisMonth']['minutes']} min in {spa['thisMonth']['month']}")
# Olympus Spa: 150 min in 2026-09
```

### curl

```bash
# Every business (find the userIds)
curl -sS https://transcribe-app-backend.vercel.app/usage/minutes \
  -H "Authorization: Bearer $USAGE_API_KEY"

# One business
curl -sS "https://transcribe-app-backend.vercel.app/usage/minutes?userId=3f1c9a2e-5b7d-4c1a-9e0f-2d6b8a4c7e11" \
  -H "Authorization: Bearer $USAGE_API_KEY"

# Just the business names and ids (needs jq)
curl -sS https://transcribe-app-backend.vercel.app/usage/minutes \
  -H "Authorization: Bearer $USAGE_API_KEY" \
  | jq -r '.minutes[] | select(.userId != null) | "\(.userId)  \(.businessName)"'
```

## Endpoint reference

### `GET /usage/minutes` — requires API key

Call time per business: the current month so far and the previous calendar month.

| Query parameter | Required | Meaning |
| --- | --- | --- |
| `userId` | No | A business's `userId`: returns only that business, as a one-entry list. `unassigned`: calls on numbers no business owns — a one-entry list, or an empty one if there have never been any. Left out or blank: every business, busiest this month first, with the unassigned bucket last. |
| `from`, `to` | No — send both or neither | ISO 8601 instants (offset or `Z`) bounding a range, `from` inclusive and `to` exclusive. Adds `periodSeconds`/`periodMinutes`/`periodCalls` to each business and `from`/`to`/`settled`/`settleSeconds`/`coverageFrom` to the response. See [Usage between two dates](#usage-between-two-dates). |

- **Headers:** `Authorization: Bearer ak_…`
- **Body:** none.
- **Responses:**
  - `200` `{ timezone, minutes: [ … ] }`, plus `from`, `to`, `settled`, `settleSeconds`, `coverageFrom` when
    `from`/`to` were sent — see [Response fields](#response-fields) and
    [Usage between two dates](#usage-between-two-dates).
  - `400` `invalid_range` — `from`/`to` malformed, only one of them sent, or `from` at or after `to`.
  - `400` `range_too_long` — the range covers more than 366 days.
  - `401` `invalid_api_key` or `unauthorized`.
  - `404` `business_not_found` — the `userId` isn't a business.

### `GET /health` — no authentication

Confirms the service is up and reachable. Use it for connectivity checks and monitoring — test your key
against `/usage/minutes`.

- **Parameters:** none.
- **Responses:** `200` `{ "status": "ok", "uptime": 5231.4 }` — uptime in seconds.

## Response fields

Every entry in `minutes` has these fields, whether you asked for one business or all of them.

| Field | Type | Meaning |
| --- | --- | --- |
| `timezone` | string | Top level, not per entry. The timezone months are measured in (IANA name). |
| `userId` | string · null | The business's permanent id — what you pass as `?userId=`. `null` for the unassigned bucket. |
| `businessName` | string · null | The business's name, or `null` if it hasn't been set. Can change; don't use it as a key. |
| `email`, `name` | string · null | The business owner's account email and name. |
| `currentMonth` | string | `YYYY-MM` — the month in progress. |
| `currentSeconds` | integer | Whole seconds of call time this month. **Use this for billing and any calculation.** |
| `currentMinutes` | number | The same total in minutes, rounded to one decimal. For display. |
| `previousMonth` | string | `YYYY-MM` — always the calendar month before, even if it had no calls. |
| `previousSeconds` | integer | Last month's final total in seconds. It no longer changes. |
| `previousMinutes` | number | Last month's total in minutes, rounded to one decimal. |
| `updatedAt` | string · null | ISO 8601 time a call last added to this business's total, or `null` if none yet. |

**With `from`/`to`.** Each entry in `minutes` also gains `periodSeconds`, `periodMinutes` and `periodCalls`, and the response
gains `from`, `to`, `settled`, `settleSeconds` and `coverageFrom`. See
[Usage between two dates](#usage-between-two-dates) for what each one means and a full example.

**What counts as call time.** Every call the voice agent handles: inbound and outbound, answered or not,
including calls that left no transcript. Each call is measured from when its audio starts to when it ends,
and added to the business that owns the phone number the call came in on or went out from. A call
transferred to a person that comes back to the agent counts as two calls. Totals only grow during a month.

**Expect new fields over time.** Ignore any field you don't recognise. Existing fields keep their names and
meanings.

## Errors and what to do

Every response is JSON. Errors carry an `error` code to branch on, and a `message` for people.

| Status | `error` | Cause | What your integration should do |
| --- | --- | --- | --- |
| `400` | `invalid_range` | `from`/`to` isn't a valid ISO 8601 instant with an offset or `Z`, only one of the two was sent, or `from` is at or after `to`. | Don't retry unchanged. Fix the request — see [Usage between two dates](#usage-between-two-dates). This is checked before your key, so you'll see it even if the key is also wrong. |
| `400` | `range_too_long` | The range from `from` to `to` covers more than 366 days. | Don't retry unchanged. Split the request into ranges of 366 days or less. |
| `401` | `invalid_api_key` | The key is wrong, or it has been revoked. | **Stop and alert someone.** Don't retry. Check the configured key, or ask TecAce for a new one. |
| `401` | `unauthorized` | No `Authorization` header, or its value isn't an `ak_` key. | Send `Authorization: Bearer ak_…` with the full key. |
| `404` | `business_not_found` | No business has that `userId` — mistyped, or the business was removed. | Don't retry. Look the business up again in the full list (step 1). |
| `5xx` | — | A temporary problem on TecAce's side. | Retry with backoff — for example after 5 seconds, 30 seconds, then 2 minutes — and alert if it keeps failing. Retrying is always safe. |
| Timeout | — | No response, or the network failed. | Treat like a `5xx`. Use a request timeout of about 10 seconds. |

## Polling and caching

Totals change only when a call ends, so there's no benefit to asking often. There is no enforced rate
limit — please stay within these. If you track many businesses, one request for all of them is cheaper
than one request each.

| Use | Suggested interval |
| --- | --- |
| Showing a business's usage on a screen | On demand when someone opens the page, cached for 5 minutes |
| Billing or reporting | Hourly or daily |
| Closing out a month | Once after the 1st, reading `previousSeconds` |
| Refreshing your stored list of `userId`s | Daily, or when a business you expect is missing |
| Most frequent reasonable | Once a minute |

Cache the last good response and show it if a request fails, rather than showing nothing.

## Keeping the key safe

Anyone holding the key can read every business's usage. Treat it like a password.

**Do**
- Keep it on your server, in environment variables or a secret manager.
- Use separate keys for staging and production, so either can be revoked alone.
- Limit who can see it to the people who operate the integration.
- Hide the `Authorization` header in logs, error reports and request tracing.
- Tell TecAce straight away if you think it has been exposed.

**Don't**
- Put it in browser JavaScript or a mobile app — anyone with the app can read it.
- Commit it to git, or paste it into tickets, chat or screenshots.
- Send it in a URL or query string.
- Share it with another system — ask TecAce for a key of its own.

## Replacing a key

To change keys without any downtime, work through these in order:

1. Ask TecAce for a new key. The old one keeps working meanwhile.
2. Deploy the new key to your server's configuration.
3. Confirm it's in use — your requests return `200`, and TecAce can see the new key's "last used" time update.
4. Ask TecAce to revoke the old key.

**If a key has leaked, don't wait for the rotation.** Ask TecAce to revoke it immediately, then deploy the
replacement. Your requests return `invalid_api_key` in between.

## Before going live

- [ ] The key is stored as a server-side secret and nowhere else.
- [ ] `GET /health` returns `200` from your production server.
- [ ] `GET /usage/minutes` lists the businesses you expect, and you've stored each one's `userId`.
- [ ] `GET /usage/minutes?userId=…` returns the right business for each stored id.
- [ ] Businesses are looked up by `userId`, never by name.
- [ ] Calculations use `currentSeconds` and `previousSeconds`, not the rounded minutes.
- [ ] A `401` alerts someone, and a `404` is reported as a bad `userId` — neither is retried.
- [ ] `5xx` responses and timeouts retry with backoff.
- [ ] Polling is no more often than once a minute, and logs don't contain the key.

Questions, a new key, or a revoked one: contact your TecAce administrator.
