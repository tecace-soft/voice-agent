# Voice Agent Usage API

Read how many minutes the voice agent has spent on calls for each business — this month so far, and
last month's final total. Read-only, JSON over HTTPS, authenticated with an API key issued to your
integration.

| | |
| --- | --- |
| Base URL | `https://transcribe-app-backend.vercel.app` |
| Authentication | API key, sent as a bearer token |
| Endpoints you can call | `GET /usage/minutes` (API key), `GET /health` (none) |
| Access | Read-only; no expiry until revoked |

## Quick start

1. **Get your API key from TecAce.** An administrator creates one for your integration (dashboard:
   Settings → API keys) and sends it to you. It starts with `ak_` and is shown to them only once — if
   it's lost, ask for a new one.
2. **Store it as a server-side secret**, e.g. `USAGE_API_KEY` in your server's environment or secret
   manager. Never in browser code, a mobile app, or a file committed to git.
3. **Make your first request from your server.** A `200` with a `minutes` list means you're connected:

   ```bash
   curl -sS https://transcribe-app-backend.vercel.app/usage/minutes \
     -H "Authorization: Bearer $USAGE_API_KEY"
   ```

## Authentication

Send the key on every request as a bearer token. Always use HTTPS; never put the key in a URL or query
string — URLs end up in logs.

```
Authorization: Bearer ak_your_key_here
```

| Key property | What it means for you |
| --- | --- |
| Format | `ak_` followed by 32 URL-safe characters. |
| Scope | Issued for **one business** or **every business**. It decides which businesses the response contains — there is no parameter to change it. |
| Permissions | Read-only, and only for `GET /usage/minutes`. It can't write data or reach any other part of the service. |
| Expiry | None. Works until TecAce revokes it; stops immediately when they do. |
| Storage | TecAce keeps only a hash, so it can be replaced but never read back. |

## Endpoints

These are the only two endpoints available to your integration. Anything else on this host belongs to
TecAce's dashboard and answers `401` or `404`.

### `GET /usage/minutes` — requires API key

Call time per business: the current month so far and the previous calendar month. One entry per
business your key covers, busiest this month first.

- **Parameters:** none. **Body:** none. **Success:** `200` JSON.

```js
// Node 18+ (built-in fetch). Run on your server, never in a browser.
const res = await fetch("https://transcribe-app-backend.vercel.app/usage/minutes", {
  headers: { Authorization: `Bearer ${process.env.USAGE_API_KEY}` },
});

if (res.status === 401) {
  // Wrong or revoked key: retrying won't help. Alert someone and get a new key.
  const { error } = await res.json();
  throw new Error(`Usage API rejected the key (${error})`);
}
if (!res.ok) throw new Error(`Usage API returned ${res.status}; retry with backoff`);

const { timezone, minutes } = await res.json();
```

```python
import os
import requests

resp = requests.get(
    "https://transcribe-app-backend.vercel.app/usage/minutes",
    headers={"Authorization": f"Bearer {os.environ['USAGE_API_KEY']}"},
    timeout=10,
)
if resp.status_code == 401:
    raise RuntimeError(f"Usage API rejected the key: {resp.json().get('error')}")
resp.raise_for_status()  # 5xx: retry later with backoff
data = resp.json()
```

Example response (`200`, example values):

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

### `GET /health` — no authentication

Confirms the service is up and reachable. Use it for connectivity checks and monitoring; it says nothing
about your key, so test the key against `/usage/minutes`.

```bash
curl -sS https://transcribe-app-backend.vercel.app/health
# {"status":"ok","uptime":5231.4}
```

## Reading the response

`minutes` is always a list. A key for one business returns exactly one entry (zeroes before its first
call); a key for every business returns one entry each.

| Field | Type | Meaning |
| --- | --- | --- |
| `timezone` | string | Timezone months are measured in (IANA). A month starts at midnight on the 1st in this zone. |
| `userId` | string · null | The account that owns the business. `null` for calls on numbers no customer owns yet. |
| `email`, `name` | string · null | That account's email and name. |
| `businessName` | string · null | The business's name, or `null` if not set. |
| `currentMonth` | string | `YYYY-MM` — the month in progress. |
| `currentSeconds` | integer | Whole seconds of call time this month. **Use for billing and calculations.** |
| `currentMinutes` | number | Same total in minutes, rounded to one decimal. Display only. |
| `previousMonth` | string | `YYYY-MM` — always the calendar month before, even with no calls. |
| `previousSeconds` | integer | Last month's final total in seconds. No longer changes. |
| `previousMinutes` | number | Last month's total in minutes, rounded to one decimal. |
| `updatedAt` | string · null | ISO 8601 time a call last added to this business's total, or `null`. |

**What counts as call time.** Every call the voice agent handles: inbound and outbound, answered or not,
including calls that left no transcript. Each call is measured from when its audio starts to when it
ends, and added to the business that owns the phone number the call came in on or went out from. A call
transferred to a person that comes back to the agent counts as two calls. Totals only grow during a
month; on the 1st the month in progress becomes `previousMonth` and the new month starts at zero.

**Expect new fields over time.** Ignore fields you don't recognise; existing fields keep their meaning.

## Errors and what to do

Every response is JSON. Errors carry an `error` code to branch on and a `message` for people.

| Status | `error` | Cause | What your integration should do |
| --- | --- | --- | --- |
| `200` | — | Success. | Read `minutes`. |
| `401` | `invalid_api_key` | Key is wrong or revoked. | **Stop and alert someone.** Don't retry. Check the configured key or ask TecAce for a new one. |
| `401` | `unauthorized` | No `Authorization` header, or its value isn't an `ak_` key. | Send `Authorization: Bearer ak_…` with the full key. |
| `5xx` | — | Temporary problem on TecAce's side. | Retry with backoff (e.g. 5s, 30s, 2m), alert if it persists. Retrying is always safe. |
| Timeout | — | No response / network failure. | Treat like `5xx`. Use a ~10 second request timeout. |

## Polling and caching

Totals change only when a call ends. No limit is enforced — please stay within these:

| Use | Suggested interval |
| --- | --- |
| Showing usage on a screen | Every 5 minutes, or on demand |
| Billing or reporting | Hourly or daily |
| Closing out a month | Once after the 1st, reading `previousSeconds` |
| Most frequent reasonable | Once a minute |

Cache the last good response and show it if a request fails.

## Keeping the key safe

Anyone holding the key can read the usage data it covers. Treat it like a password.

**Do**
- Keep it on your server, in environment variables or a secret manager.
- Use separate keys for staging and production, so either can be revoked alone.
- Limit who can see it to the people who operate the integration.
- Hide the `Authorization` header in logs, error reports and request tracing.
- Tell TecAce straight away if you think it has been exposed.

**Don't**
- Put it in browser JavaScript or a mobile app.
- Commit it to git, or paste it into tickets, chat or screenshots.
- Send it in a URL or query string.
- Share it with another system — ask TecAce for a key of its own.

## Replacing a key

To change keys without downtime:

1. Ask TecAce for a new key. The old one keeps working meanwhile.
2. Deploy the new key to your server's configuration.
3. Confirm it's in use — your requests return `200`, and TecAce sees the new key's "last used" time update.
4. Ask TecAce to revoke the old key.

**If a key has leaked, don't wait:** have it revoked immediately, then deploy the replacement. Requests
return `invalid_api_key` in between.

## Before going live

- [ ] The key is stored as a server-side secret and nowhere else.
- [ ] `GET /health` returns `200` from your production environment.
- [ ] `GET /usage/minutes` returns `200` with the businesses you expect.
- [ ] Calculations use `currentSeconds` / `previousSeconds`, not the rounded minutes.
- [ ] A `401` alerts someone instead of retrying.
- [ ] `5xx` responses and timeouts retry with backoff.
- [ ] Polling is no more often than once a minute.
- [ ] Logs don't contain the key.

Questions, a new key, or a revoked one: contact your TecAce administrator.
