# Twilio numbers in the backend — design

Date: 2026-09-28 · Status: approved (brainstorm) · Apps: `transcribe-backend`, `tecace-voice-agent-dashboard`

## Goal

Let `transcribe-backend` see the phone numbers we **own** on our Twilio account and point a number's
voice webhook at the voice agent (`openai-agent-app`). Today numbers are typed into the Numbers page
by hand and must be wired to the agent manually in the Twilio console.

Out of scope: searching/buying new numbers, SMS webhooks, per-tenant outbound caller ID, changes to
`openai-agent-app`.

## Approach

Live fetch from the Twilio REST API on each request (no SDK, plain `fetch`, Basic auth). Nothing
new is stored: Twilio stays the source of truth for what we own and where it points; `agent_numbers`
stays the source of truth for who a number answers as. No schema change.

## Config (transcribe-backend env, all optional)

| Var | Meaning |
|---|---|
| `TWILIO_ACCOUNT_SID` | Account (`AC…`) whose numbers are listed |
| `TWILIO_API_KEY_SID` + `TWILIO_API_KEY_SECRET` | Preferred credentials (restricted API key; needs phone-number read + write) |
| `TWILIO_AUTH_TOKEN` | Fallback credential when no API key is set (username = account SID) |
| `AGENT_PUBLIC_URL` | Agent base URL, e.g. `https://31-97-214-59.sslip.io` (no trailing slash needed) |

- Twilio is "configured" when the account SID and either the API key pair or the auth token are set.
- Not configured → the list answers **200** `{ configured: false, agentUrl: null, numbers: [] }` (a
  normal deployment state; a 503 would log a browser console error on every page visit). Connect
  answers **503** `{ error: "twilio_not_configured", message }`.
- Connect additionally needs `AGENT_PUBLIC_URL`; without it → **503** `agent_url_not_configured`.
  Listing still works without it (every number's status is then computed against no URL → reported
  as `not_connected` / `elsewhere`, and `agentUrl` is `null`).
- Manual number entry (`POST /business/numbers`) is unchanged and works regardless.

## Backend module `src/twilio/numbers.ts`

- `twilioConfigured(): boolean`
- `listOwnedNumbers(): Promise<TwilioNumber[]>` — `GET https://api.twilio.com/2010-04-01/Accounts/{sid}/IncomingPhoneNumbers.json?PageSize=1000`,
  follows `next_page_uri` until null. Maps to `{ sid, phoneE164, friendlyName, voiceUrl, voiceFallbackUrl }`
  (empty strings → `null`).
- `connectNumber(sid): Promise<TwilioNumber>` — `POST …/IncomingPhoneNumbers/{sid}.json`, form body
  `VoiceUrl=<base>/incoming`, `VoiceMethod=POST`, `VoiceFallbackUrl=<base>/incoming-fallback`,
  `VoiceFallbackMethod=POST`.
- `agentStatus(voiceUrl, agentBase): "connected" | "not_connected" | "elsewhere"`
  - `not_connected`: `voiceUrl` null/empty.
  - `connected`: `voiceUrl` equals `<agentBase>/incoming`, comparing scheme+host case-insensitively
    and ignoring a trailing slash.
  - `elsewhere`: anything else (including any URL when `agentBase` is null).
- Errors: a `TwilioError` carrying `kind: "auth" | "not_found" | "other"` and Twilio's message.
  Secrets are never logged or returned.

The base URL of the Twilio API is overridable (`TWILIO_API_BASE`, default `https://api.twilio.com`)
only so tests can assert URLs; not documented for operators.

## Routes (admin only, own controller `routes/twilioNumbers.ts`, prefix `/business/numbers/twilio`)

Both use `authenticateAdmin` with the same admin-only message as the existing numbers
routes (401 signed out, 403 customer).

### `GET /business/numbers/twilio`

```json
{
  "configured": true,
  "agentUrl": "https://31-97-214-59.sslip.io/incoming",
  "numbers": [
    {
      "sid": "PN…", "phoneE164": "+14255988987", "friendlyName": "(425) 598-8987",
      "voiceUrl": "https://…/incoming", "status": "connected",
      "registered": { "id": "…", "label": null, "userId": "…", "userName": "…", "userEmail": "…" }
    }
  ]
}
```

`registered` is the matching `agent_numbers` row by `phone_e164`, or `null`. Sorted by `phoneE164`.

### `POST /business/numbers/twilio/:sid/connect`

Body `{ overwrite?: boolean }`. Steps: check config → fetch the number (list, find by sid; unknown sid
→ **404** `not_found`) → if status is `elsewhere` and `overwrite !== true` → **409**
`{ error: "points_elsewhere", message: "… currently sends calls to <url>. …", voiceUrl }` → else
`connectNumber` → **200** with the same per-number shape as the list.

### Twilio failures

`kind: "auth"` → **502** `twilio_auth` ("Twilio rejected the credentials — check TWILIO_* on the
backend."); `not_found` from Twilio → **404**; anything else → **502** `twilio_error` with Twilio's
message.

## Dashboard (`src/pages/NumbersPage.tsx`, hand-rolled CSS — transcribe side)

New first card **"On our Twilio account"**:

- Table: Number · Agent (status badge) · In our list (assignee name, "Not assigned", or "Not added") · actions.
- Badges: `Connected` (success), `Not connected` (warning), `Points elsewhere` (warning; `title` shows the URL).
- Actions per row:
  - **Connect to agent** when status ≠ connected. For `elsewhere`, `window.confirm` naming the current
    URL, then retry with `overwrite: true`.
  - **Add to list** when `registered` is null → existing `registerAgentNumber(phone, "")`.
- `configured: false` → one muted line in the card ("Twilio isn't connected to the backend
  yet. Set TWILIO_ACCOUNT_SID and an API key on the backend to see our numbers here.") — not an
  error style. Other errors → the page's existing error line.
- After any action the page reloads both lists.
- Existing cards (manual add form, assigned numbers table) stay as they are.

API client (`src/api/backend.ts`): `listTwilioNumbers()`, `connectTwilioNumber(sid, overwrite?)`;
types `TwilioNumber`, `TwilioNumbersResponse` in `src/api/types.ts`.

Follows `tecace-dashboard-ui` rules: sentence case, tokens not hex, existing `badge-*` / `btn-*` classes.

## Testing

- Backend `src/twilio/numbers.test.ts` (mocked `fetch`): parsing + pagination, Basic auth header for
  API key vs auth token, `agentStatus` cases, connect form body, error mapping.
- Backend route tests (`src/routes/twilioNumbers.pg.test.ts`, PGlite + mocked fetch): 401/403/200,
  `registered` merge, 503 not configured, 404 unknown sid, 409 points_elsewhere, overwrite, 502 on Twilio 401.
- Dashboard: `scripts/regression/fake_backend.py` answers `GET /business/numbers/twilio` with
  `configured: false` so existing regression scripts are unaffected; `npm test` + `compare.py`
  (Numbers page is admin-only; confirm IDENTICAL or hide the new card in `compare.py` if it differs).
- `bun run typecheck`, `bun test`, `npm run build`.

## Rollout / docs

- `transcribe-backend/.env.example`: add the five vars (with comments).
- Changelog `0.0.10` (2026-09-28), `admin: true` line: "Agent numbers lists the numbers on our Twilio
  account and can connect one to the agent." Bump `package.json` + lock root.
- HISTORY.md entry: new routes, new env vars, ⚠ set them on Vercel (`transcribe-app-backend`, and
  staging `va-staging-backend`) with a restricted Twilio API key.
- Nothing is committed by Claude (user handles git).
