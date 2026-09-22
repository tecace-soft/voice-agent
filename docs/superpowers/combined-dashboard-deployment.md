# Combined dashboard — deployment checklist

Audience: whoever is putting `tecace-voice-agent-dashboard/` live. The front-end work is done; this
is what's left to do that in production. For why the app is shaped this way (transcribe screens +
an admin-only Demos section, and why the prospect-facing page stays on the promo rather than being
ported here), see `docs/superpowers/specs/2026-09-21-combined-dashboard-design.md`.

## 1. What this app is

One Vite SPA (`tecace-voice-agent-dashboard/`) combining two things behind a single sign-in:

- The **transcribe dashboard** screens (ported from `transcribe-dashboard-app`), which talk to
  **`transcribe-backend`**: sign-in/accounts, `/transcribe/*` stats and failures, `/business/*`
  profile and agent numbers, `/calls`, `/usage/*` minutes, `/feedback`, `/api-keys`.
- An **admin-only Demos section**, ported from the separate `voiceagent_promo` (Next.js) repo's
  admin side. It talks to the promo's own backend through the same-origin `/promo-api` prefix
  (`src/demos/api.ts`), which is proxied to the promo's `/api/*`.

The prospect-facing demo page itself (`/c/<id>`) is **not** part of this app and is never proxied
through it. It is served by the voiceagent_promo deployment directly; this app only links to it
(Prospects list, Share screen) via `VITE_PUBLIC_DEMO_BASE_URL`. That's a deliberate decision (see
the spec) — porting the page here would have lost its server-rendered link previews and put an
unauthenticated public page on the same origin as this app's session token.

## 2. Build-time env (`VITE_*`, baked into the built JS)

Set in `.env` for local dev, and in the Vercel project's environment variables for production.
Source: `.env.example`, `vite.config.ts`, `src/api/backend.ts`, `src/demos/lib/share.ts`.

- **`BACKEND_URL`** — base URL of `transcribe-backend` (no trailing slash), e.g.
  `https://transcribe-backend.example.com`. Everything the transcribe screens do — sign-in, stats,
  business profile, calls, api-keys — goes through this. If it's unset, `src/api/backend.ts` throws
  `"Backend URL is not configured (set BACKEND_URL)."` on the first call and the app is
  unusable (can't even sign in).
- **`VITE_PUBLIC_DEMO_BASE_URL`** — the promo's public origin (no trailing slash), e.g.
  `https://demo.tecace.com`. This is what the Prospects and Share screens use to build the `/c/<id>`
  links they copy and email (`src/demos/lib/share.ts`). If unset, those links fall back to
  `window.location.origin` — i.e. this dashboard's own origin — so a prospect who clicks the link
  lands on the dashboard's sign-in page instead of the demo. `npm run build` prints a warning to the
  build log when this is unset (see `vite.config.ts`), but it does not fail the build.
- **`VITE_CONTACT_*`** (optional: `VITE_CONTACT_URL`, `VITE_PRICING_URL`, `VITE_CONTACT_EMAIL`) —
  contact links shown on the promo's public demo page. Defaults are TecAce's own; leave unset unless
  they need overriding.

## 3. Server-side env (`PROMO_API_URL`)

`PROMO_API_URL` (no `VITE_` prefix, so it never reaches the browser) points the `/promo-api` dev/
preview proxy at a running voiceagent_promo instance. It is read by `vite.config.ts` and only
matters for `npm run dev` and `npm run preview` — the Vite dev server process needs to know where to
forward `/promo-api/*` requests. **Production does not use it at all**: a deployed build has no Vite
process running the proxy, so the routing has to come from the hosting platform's own rewrite
instead (see §4). Setting `PROMO_API_URL` in the Vercel project has no effect.

## 4. `vercel.json` — the production `/promo-api` rewrite

Current `vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

That's only the SPA catch-all (every path falls back to `index.html` so client-side routing works
on a refresh/deep link). It has **no** rule for `/promo-api` yet — that has to be added before the
first production deploy:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "rewrites": [
    { "source": "/promo-api/:path*", "destination": "<promo origin>/api/:path*" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

Order matters: the `/promo-api/:path*` rule must come **before** the SPA catch-all, or every
`/promo-api/*` request will match the catch-all first and get back `index.html` instead of reaching
the promo. `<promo origin>` is the voiceagent_promo deployment's own origin (e.g.
`https://demo.tecace.com`) — the same value as `VITE_PUBLIC_DEMO_BASE_URL` from §2, with `/api/:path*`
appended in the destination.

Add nothing wider than this one rule — nothing else of the promo should be proxied onto this origin
(see §1 and the spec's "Decision" note: the dashboard's session token lives in `localStorage` here,
so promo HTML must never run on this origin).

**What breaks without it:** every Demos view calls `probePromo()` on first visit
(`src/demos/api.ts`), which hits `/promo-api/admin/health`. With no rewrite, Vercel's SPA catch-all
answers with `index.html` instead of JSON, `promoRequest` classifies that as `unreachable`, and
`DemosGate` shows "Demo service unreachable" on every Demos view — the whole section is unusable.

## 5. Other systems to touch

- **`transcribe-backend`'s `CORS_ORIGIN`** — add this deployment's origin to the comma-separated
  list (`transcribe-backend/src/config/env.ts` reads `CORS_ORIGIN`, `.env.example` shows the format:
  `CORS_ORIGIN=https://your-dashboard.vercel.app,http://localhost:5175` for local dev too). Unset
  means the backend reflects any origin (fine for dev, not for production); once it's set to an
  explicit list, this app's origin has to be in it or every `transcribe-backend` call fails as a CORS
  error in the browser (sign-in included).
- **The promo's `NEXT_PUBLIC_BASE_URL`** — confirm the voiceagent_promo deployment itself still has
  this set to its own origin. It's what the promo uses to build its own share links, and it must
  match `VITE_PUBLIC_DEMO_BASE_URL` here (§2) — if the two diverge, the two apps disagree about what
  the demo's public URL is.
  - Its `.env.example` is `test_demo/voiceagent_promo/.env.example`, and its README (same repo) is
    the source of truth for the rest of its own env: `OPENAI_API_KEY` (voice, needs a paid tier),
    `ADMIN_PASSWORD` (see below), `ADMIN_SESSION_SECRET`, `LIVE_MODEL`/`BACKEND_MODEL`/`LIVE_VOICE`,
    research provider settings (`ANTHROPIC_API_KEY` on Vercel, since there's no Claude CLI to spawn
    there — the README calls this out explicitly), and storage (`KV_REST_API_URL` /
    `KV_REST_API_TOKEN`, required on Vercel since the filesystem is read-only there; without them the
    promo writes to a disk that disappears between requests).
- **The promo's `ADMIN_PASSWORD`** — admins unlock the Demos section in *this* app with it, once per
  browser (`src/demos/api.ts`'s `unlockPromo`, `POST /admin/login`; `PromoAuth` in `CLAUDE.md`'s
  terms). It is a separate credential from this dashboard's own sign-in; it isn't configured in this
  app at all, only in the promo.

## 6. First-run checks

After deploying, in order:

1. Sign in to the dashboard (`transcribe-backend` sign-in).
2. Confirm a transcribe view loads (e.g. Overview stats) — proves `BACKEND_URL` and
   `CORS_ORIGIN` are both right.
3. Open **Demos**. It should ask to unlock with the promo's `ADMIN_PASSWORD`, then list prospects —
   proves the `/promo-api` rewrite (§4) is in place and pointed at a live promo.
4. Open a prospect's page and confirm it loads.
5. If an OpenAI key is in play on the promo side, place a real test call — see the app's own
   `README.md` ("Trying a real test call") for the steps (unlock Demos, open a *ready* prospect,
   press the test call, allow the microphone). It's a real GPT-Live-1 session billed to that OpenAI
   key, tagged as a test so it doesn't count against the prospect's demo minutes.

## 7. Two things to confirm in production, not assume

- **The promo's `/api/session` rate limit may key on the wrong address.** It allows 5 calls/minute
  per IP, read from `x-forwarded-for` (`voiceagent_promo/app/api/session/route.ts`). Reached through
  this app's Vercel rewrite, that header may carry Vercel's own egress address rather than each
  admin's — which would put every admin's test calls into one shared bucket instead of one each.
  (Through the local Vite dev proxy, by contrast, the caller is always seen as `"local"`.) This runs
  before the test-call check in §6 even starts a session, so if test calls start failing with "Too
  many calls in a row," this is why.
- **Whether a long re-research survives the rewrite's own proxy timeout.** The promo's research
  route allows up to 300 seconds (`export const maxDuration = 300` in
  `voiceagent_promo/app/api/admin/customers/[id]/research/route.ts`; its own README says a run
  typically takes two to three minutes). A Vercel rewrite proxies the request but may have a shorter
  timeout of its own, in which case this app could show a gateway error while the research keeps
  running to completion on the promo side regardless — the record reloads either way once you check
  back, but confirm what actually happens here rather than assuming the rewrite waits it out.

## 8. Still open, deliberately

- **`transcribe-dashboard-app`** (the original, separate dashboard) is untouched and still deployed.
  Retiring it is the user's call, made once this combined app is confirmed live and working.
- **Merging the promo's backend into `transcribe-backend`** remains a separate, future piece of
  work. When that happens, `src/demos/api.ts` and the one `/promo-api` rewrite (§4) are what would
  change — nothing else in this app should need to.
