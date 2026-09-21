# Combined dashboard — stage 3 (promo plumbing) implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admins a working "Demos" section in the combined dashboard that talks to the promo app's existing API through a same-origin proxy, behind a one-time "Unlock demos" password card — with placeholder screens that prove the whole path (proxy → cookie → router ids) end to end. Also fix the `#/apiKeys` refresh bug.

**Architecture:** One module (`src/demos/api.ts`) knows where the promo is: every call goes to same-origin `/promo-api/*`, which Vite's dev/preview proxy forwards to the promo's `/api/*`, so the promo's own httpOnly admin cookie works unchanged. A `PromoAuth` context tracks `idle → checking → locked | unlocked | unreachable`, probed on the first Demos visit only; any promo 401 flips it back to `locked` without touching the dashboard sign-in. The hash router gains path patterns with an `:id` segment (`#/demos/prospects/<id>`), declared in a `Record<ViewId, string>` so a view can no longer be missing from the router (the `apiKeys` bug). Demos screens render inside `<div className="tw">` and use Tailwind utilities (stage 2's scoped styling).

**Tech Stack:** React 19, Vite 8 (server/preview proxy, `define`), TypeScript 5, Tailwind 4 (scoped to `.tw`), Vitest 5, Python 3.14 + Playwright (Edge) for the regression and end-to-end scripts.

**Spec:** `docs/superpowers/specs/2026-09-21-combined-dashboard-design.md` (sections 2, 4, 5, 6; stage 3).

**Decided for this stage:** the production `vercel.json` rewrite is **deferred** to first deployment (the promo's URL isn't settled) — only the dev/preview proxy is wired. No promo repo changes; promo behaviour is exercised against a fake (`fake_promo.py`).

**Git:** do **not** commit. The user handles all git. Steps end at "files ready for review".

**Conventions:** paths are relative to `tecace-voice-agent-dashboard/` (`APP`) unless they start with `docs/` or `../`. Git Bash on Windows; quote paths (they contain a space). Hand-written text files in this project use **CRLF** line endings (git `core.autocrlf=true`); keep whatever the file you edit already uses. Transcribe CSS lives in `src/styles/legacy.css`; promo markup uses Tailwind utilities **inside** a `.tw` element and never on the `.tw` element itself (see `CLAUDE.md`). Never put a bare `var(--border)`/`var(--primary)`-style reference in promo markup.

**Regression harness facts:** `python scripts/regression/compare.py` builds `../transcribe-dashboard-app` and APP against `scripts/regression/fake_backend.py` (127.0.0.1:8899; tokens `tok-admin`/`tok-user`), compares 44 captures, prints `IDENTICAL` (exit 0) / differences (exit 1) / `HARNESS FAILURE` (exit 2). ~3 min. Ports 5198, 5199, 8899 must be free; never run two harness scripts at once. It exports `APP_ROOT, BACKEND_PORT, NEW_PORT, OUT_DIR, HarnessError, build, check_ports_free, serve, stop, settle`.

---

## File map

- Modify `scripts/regression/compare.py` — `HIDE` list + `EXPECTED_CHANGES` (Task 1)
- Modify `scripts/regression/README.md` (Tasks 1, 7)
- Modify `src/routing.ts`; create `tests/routing.test.ts` (Task 2)
- Modify `src/components/Sidebar.tsx` (ViewId union in Task 2; Demos group in Task 6)
- Modify `src/App.tsx` (VIEW_TITLES in Task 2; wiring in Task 6)
- Create `src/demos/api.ts`; create `tests/promoApi.test.ts` (Task 3)
- Modify `vite.config.ts`, `.env.example`; create `src/demos/env.d.ts`, `scripts/regression/fake_promo.py` (Task 4)
- Create `src/demos/views.ts`, `src/demos/PromoAuth.tsx`, `src/demos/DemosGate.tsx`, `src/demos/UnlockCard.tsx`, `src/demos/prospectStatus.ts`, `src/demos/pages/DemoPlaceholderPage.tsx`, `src/demos/pages/DemoProspectsPage.tsx`, `src/demos/pages/DemoProspectPage.tsx`, `src/demos/DemosView.tsx` (Task 5)
- Modify `src/icons.tsx` (Task 6)
- Create `scripts/regression/demos_e2e.py` (Task 7)
- Modify `CLAUDE.md`, `README.md`, `docs/superpowers/specs/2026-09-21-combined-dashboard-design.md` (Task 8)

---

### Task 1: Teach the regression harness about intended differences

**Files:**
- Modify: `scripts/regression/compare.py`
- Modify: `scripts/regression/README.md`

Stage 3 changes two things on purpose: the admin sidebar gains a **Demos** group, and `#/apiKeys` will finally open API keys (the original app lands on Overview — a routing bug). The harness must keep proving everything *else* is identical, so: elements listed in `HIDE` get `display:none` (which removes them from layout entirely, so the page is laid out exactly as the old app's) and are skipped by the fingerprint; captures listed in `EXPECTED_CHANGES` must show a marker text in the new app that the old app doesn't have — a *proven* change, not a skipped one.

- [ ] **Step 1: Add the two lists and the hide script**

In `scripts/regression/compare.py`, directly after the `INTERACTIONS = [...]` list, add:
```python
# Elements that exist only in the new app by design. Before every capture (in BOTH runs) they get
# display:none — which takes them out of layout entirely, so the rest of the page is laid out
# exactly as in the old app — and the fingerprint skips them. Everything else must still match.
HIDE = [
    '.sidebar-group[data-group="demos"]',  # stage 3: the admin-only Demos nav group
]

# Captures that are MEANT to differ: id -> (why, marker). The marker must appear in the new app's
# text and not in the old app's — the change is proven, not merely skipped.
EXPECTED_CHANGES = {
    "admin:apiKeys:light": (
        "stage 3 fixed routing: #/apiKeys opens API keys (the original lands on Overview)",
        "Let another system read call minutes",
    ),
}

HIDE_JS = """
(selectors) => {
  for (const sel of selectors) {
    for (const el of document.querySelectorAll(sel)) {
      el.style.setProperty("display", "none", "important");
      el.setAttribute("data-regression-hidden", "");
    }
  }
}
"""
```

- [ ] **Step 2: Skip hidden elements in the fingerprint walk**

In `FINGERPRINT_JS`, inside `walk`, change the loop
```js
    for (const child of el.children) {
      const key = keyOf(child);
```
to
```js
    for (const child of el.children) {
      if (child.hasAttribute("data-regression-hidden")) continue;
      const key = keyOf(child);
```

- [ ] **Step 3: Hide before steps and again before fingerprinting**

In `capture_all`, change
```python
            page.goto(base_url + cap["hash"])
            settle(page)
```
to
```python
            page.goto(base_url + cap["hash"])
            settle(page)
            page.evaluate(HIDE_JS, HIDE)
```
and directly before `fp = page.evaluate(FINGERPRINT_JS, STYLE_PROPS)` add:
```python
            page.evaluate(HIDE_JS, HIDE)  # again: a step may have re-rendered hidden elements
```

- [ ] **Step 4: Check expected changes in `diff()`**

In `diff()`, directly after the `if b is None: … continue` block, add:
```python
        if cid in EXPECTED_CHANGES:
            why, marker = EXPECTED_CHANGES[cid]
            in_old, in_new = marker in a["text"], marker in b["text"]
            if in_old or not in_new:
                problems.append(f"[{cid}] expected change did not happen ({why}): marker "
                                f"{marker!r} in old={in_old}, in new={in_new}")
            continue
```
Then, in `run()`, immediately before the line that prints `IDENTICAL`, add a print of the confirmed expected changes (only those actually captured this run):
```python
    confirmed = [cid for cid in EXPECTED_CHANGES if cid in runs["new"]]
    if confirmed:
        print(f"expected changes confirmed: {', '.join(confirmed)}")
```
(Use whatever variable `run()` holds the new captures in — read `run()` first; the name above assumes `runs["new"]`.)

- [ ] **Step 5: See the expected change fail (it isn't implemented yet)**

Run: `python scripts/regression/compare.py --only admin:apiKeys:light`
Expected: exit 1 with exactly one line: `[admin:apiKeys:light] expected change did not happen (…): marker 'Let another system read call minutes' in old=False, in new=False`.

- [ ] **Step 6: Everything else still identical**

Run: `python scripts/regression/compare.py --only admin:overview:light`
Expected: `IDENTICAL`, exit 0 (the Demos group doesn't exist yet, so `HIDE` matches nothing).

- [ ] **Step 7: Document it**

In `scripts/regression/README.md`, add a section:
```markdown
## Intended differences

Two lists at the top of `compare.py` cover changes made on purpose:

- `HIDE` — selectors for elements that exist only in the new app (e.g. the admin-only Demos nav
  group). They get `display:none` before every capture in both runs — which removes them from
  layout, so the rest of the page lays out as in the old app — and the fingerprint skips them.
- `EXPECTED_CHANGES` — capture ids that must differ, each with a marker text that must be in the
  new app's text and not the old app's. A proven change, not a skipped capture.

Add to these only for a change the plan calls for, with a comment naming the stage.
```

- [ ] **Step 8: Files ready for review** (no commit)

---

### Task 2: Router path patterns, record ids, and the apiKeys fix

**Files:**
- Modify: `src/routing.ts`
- Modify: `src/components/Sidebar.tsx` (the `ViewId` type only)
- Modify: `src/App.tsx` (the `VIEW_TITLES` map only)
- Create: `tests/routing.test.ts`

The router's view list is a hand-kept array, and `apiKeys` was left out of it — so refreshing on API keys lands on Overview. Replacing it with a `Record<ViewId, string>` of paths makes a missing view a compile error. The same table adds path patterns with one `:id` segment, for `#/demos/prospects/<id>`.

- [ ] **Step 1: Add the Demos view ids**

In `src/components/Sidebar.tsx`, change the `ViewId` union to:
```ts
export type ViewId =
  | "overview"
  | "analytics"
  | "people"
  | "activity"
  | "runs"
  | "failed"
  | "feedback"
  | "allFeedback"
  | "numbers"
  | "business"
  | "calls"
  | "apiKeys"
  | "accounts"
  | "demoOverview"
  | "demoProspects"
  | "demoProspect"
  | "demoPipeline";
```
In `src/App.tsx`, add to `VIEW_TITLES` (after `accounts: "Accounts",`):
```ts
  demoOverview: "Demo overview",
  demoProspects: "Prospects",
  demoProspect: "Prospect",
  demoPipeline: "Pipeline",
```

- [ ] **Step 2: Write the failing tests**

Create `tests/routing.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { formatHash, parseHash, type Route } from "../src/routing";

describe("parseHash", () => {
  it("opens API keys (it used to fall back to Overview)", () => {
    expect(parseHash("#/apiKeys").view).toBe("apiKeys");
  });

  it("matches static paths case-insensitively, as before", () => {
    expect(parseHash("#/APIKEYS").view).toBe("apiKeys");
    expect(parseHash("#/Analytics").view).toBe("analytics");
  });

  it("reads a Demos path", () => {
    expect(parseHash("#/demos/prospects")).toEqual({ view: "demoProspects", mailbox: undefined });
    expect(parseHash("#/demos/pipeline").view).toBe("demoPipeline");
  });

  it("reads a record id and keeps its case", () => {
    expect(parseHash("#/demos/prospects/AbC_12-x")).toEqual({
      view: "demoProspect",
      mailbox: undefined,
      id: "AbC_12-x",
    });
  });

  it("decodes an encoded id", () => {
    expect(parseHash("#/demos/prospects/a%2Fb").id).toBe("a/b");
  });

  it("falls back to Overview for anything unknown", () => {
    expect(parseHash("").view).toBe("overview");
    expect(parseHash("#/nope").view).toBe("overview");
    expect(parseHash("#/demos/prospects/x/extra").view).toBe("overview");
  });

  it("keeps the mailbox scope, as before", () => {
    expect(parseHash("#/overview?mailbox=sam%40tecace.com").mailbox).toBe("sam@tecace.com");
    expect(parseHash("#/runs?mailbox=unattributed").mailbox).toBeNull();
    expect(parseHash("#/runs").mailbox).toBeUndefined();
  });
});

describe("formatHash", () => {
  it("writes a record id into its segment, encoded", () => {
    expect(formatHash({ view: "demoProspect", mailbox: undefined, id: "a/b" })).toBe(
      "#/demos/prospects/a%2Fb",
    );
  });

  it("ignores an id on a view without an id segment", () => {
    expect(formatHash({ view: "demoProspects", mailbox: undefined, id: "x" })).toBe("#/demos/prospects");
  });

  it("writes the mailbox query, as before", () => {
    expect(formatHash({ view: "overview", mailbox: "sam@tecace.com" })).toBe(
      "#/overview?mailbox=sam%40tecace.com",
    );
    expect(formatHash({ view: "runs", mailbox: null })).toBe("#/runs?mailbox=unattributed");
  });

  it("round-trips every view", () => {
    const routes: Route[] = [
      "overview", "analytics", "people", "activity", "runs", "failed", "feedback", "allFeedback",
      "calls", "business", "numbers", "apiKeys", "accounts", "demoOverview", "demoProspects",
      "demoPipeline",
    ].map((view) => ({ view, mailbox: undefined }) as Route);
    routes.push({ view: "demoProspect", mailbox: undefined, id: "pr0SPct1" });
    for (const route of routes) expect(parseHash(formatHash(route))).toEqual(route);
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `npx vitest run tests/routing.test.ts`
Expected: FAIL — among others `opens API keys` (`expected 'overview' to be 'apiKeys'`) and the Demos/id tests.

- [ ] **Step 4: Rewrite the route table and parsing**

In `src/routing.ts`, replace everything from the example-hash comment block down to (and including) the end of `formatHash` — i.e. the comment lines listing `#/analytics …`, the `VIEWS` array, `DEFAULT_VIEW`, `UNATTRIBUTED`, the `Route` interface, `parseHash` and `formatHash` — with:
```ts
//   #/analytics
//   #/overview?mailbox=sam%40tecace.com
//   #/overview?mailbox=unattributed        (runs reported before mailboxes existed)
//   #/demos/prospects/<id>                 (a view that addresses one record)

// Every view's path. A Record, so a view missing here is a compile error rather than a page that
// silently falls back to Overview on refresh (which is what happened to API keys). `:id` marks the
// one segment a view carries a record id in.
const PATHS: Record<ViewId, string> = {
  overview: "overview",
  analytics: "analytics",
  people: "people",
  activity: "activity",
  runs: "runs",
  failed: "failed",
  feedback: "feedback",
  allFeedback: "allFeedback",
  calls: "calls",
  business: "business",
  numbers: "numbers",
  apiKeys: "apiKeys",
  accounts: "accounts",
  demoOverview: "demos/overview",
  demoProspects: "demos/prospects",
  demoProspect: "demos/prospects/:id",
  demoPipeline: "demos/pipeline",
};

const DEFAULT_VIEW: ViewId = "overview";
const UNATTRIBUTED = "unattributed";

export interface Route {
  view: ViewId;
  mailbox: MailboxScope;
  /** The record a view addresses (e.g. which prospect); only views with an `:id` path use it. */
  id?: string;
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment; // a malformed escape — keep it as typed rather than failing the whole route
  }
}

// Static segments match case-insensitively (as the old list did); an id keeps its case.
function matchPath(pattern: string, segments: string[]): { id?: string } | null {
  const parts = pattern.split("/");
  if (parts.length !== segments.length) return null;
  let id: string | undefined;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] ?? "";
    const segment = segments[i] ?? "";
    if (part === ":id") id = segment;
    else if (part.toLowerCase() !== segment.toLowerCase()) return null;
  }
  return id === undefined ? {} : { id };
}

export function parseHash(hash: string): Route {
  // "#/demos/prospects/x?mailbox=y" -> segments ["demos","prospects","x"], query "mailbox=y"
  const raw = hash.replace(/^#\/?/, "");
  const [path = "", query = ""] = raw.split("?");
  const segments = path.split("/").filter(Boolean).map(decodeSegment);

  let view: ViewId = DEFAULT_VIEW;
  let id: string | undefined;
  for (const [candidate, pattern] of Object.entries(PATHS) as [ViewId, string][]) {
    const match = matchPath(pattern, segments);
    if (match) {
      view = candidate;
      id = match.id;
      break;
    }
  }

  const asked = new URLSearchParams(query).get("mailbox")?.trim().toLowerCase();
  const mailbox: MailboxScope = !asked ? undefined : asked === UNATTRIBUTED ? null : asked;

  return id === undefined ? { view, mailbox } : { view, mailbox, id };
}

export function formatHash({ view, mailbox, id }: Route): string {
  const path = PATHS[view].replace(":id", encodeURIComponent(id ?? ""));
  const scope = mailbox === undefined ? "" : mailbox === null ? UNATTRIBUTED : mailbox;
  return `#/${path}${scope ? `?mailbox=${encodeURIComponent(scope)}` : ""}`;
}
```
Leave `useRoute` unchanged. (Its `navigate` merges `{ ...parseHash(location.hash), ...next }`; a stale `id` from the previous route is harmless because `formatHash` only writes an id into a path that has `:id`.)

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run`
Expected: all test files pass (routing, themeCore, styles).

- [ ] **Step 6: Typecheck/build, then prove the fix in the harness**

Run: `npm run build`
Expected: clean.
Run: `python scripts/regression/compare.py --only admin:apiKeys:light`
Expected: `expected changes confirmed: admin:apiKeys:light` then `IDENTICAL`, exit 0.
Run: `python scripts/regression/compare.py`
Expected: `44 captures compared; …`, `expected changes confirmed: admin:apiKeys:light`, `IDENTICAL`.

- [ ] **Step 7: Files ready for review** (no commit)

---

### Task 3: The promo API client

**Files:**
- Create: `src/demos/api.ts`
- Test: `tests/promoApi.test.ts`

The single module that knows where the promo backend is. It classifies every failure into one of three kinds the UI can act on: `unreachable` (no answer, or an answer that isn't the promo's — the promo answers everything, errors included, with JSON, so a non-JSON response came from the proxy), `locked` (401 — the promo cookie is missing or expired), `failed` (the promo answered with an error).

- [ ] **Step 1: Write the failing tests**

Create `tests/promoApi.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getProspect,
  listProspects,
  lockPromo,
  probePromo,
  PromoError,
  promoRequest,
  setPromoLockedHandler,
  unlockPromo,
} from "../src/demos/api";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  const fn = vi.fn(impl);
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  setPromoLockedHandler(null);
});

describe("promoRequest", () => {
  it("calls the same-origin proxy with the cookie", async () => {
    const fetchFn = stubFetch(async () => json(200, { customers: [] }));
    await promoRequest("GET", "/admin/customers");
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("/promo-api/admin/customers");
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("same-origin");
  });

  it("sends a JSON body", async () => {
    const fetchFn = stubFetch(async () => json(200, { ok: true }));
    await promoRequest("POST", "/admin/login", { password: "p" });
    const [, init] = fetchFn.mock.calls[0]!;
    expect(init.body).toBe(JSON.stringify({ password: "p" }));
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });

  it("returns the parsed body", async () => {
    stubFetch(async () => json(200, { customers: [{ id: "a" }] }));
    await expect(promoRequest("GET", "/admin/customers")).resolves.toEqual({ customers: [{ id: "a" }] });
  });

  it("calls it unreachable when fetch itself fails", async () => {
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(promoRequest("GET", "/admin/health")).rejects.toMatchObject({ kind: "unreachable", status: 0 });
  });

  it("calls it unreachable when the answer isn't the promo's JSON", async () => {
    stubFetch(async () => new Response("Bad Gateway", { status: 502, headers: { "content-type": "text/plain" } }));
    await expect(promoRequest("GET", "/admin/health")).rejects.toMatchObject({ kind: "unreachable", status: 502 });
  });

  it("calls it locked on a 401 and tells the handler", async () => {
    const onLocked = vi.fn();
    setPromoLockedHandler(onLocked);
    stubFetch(async () => json(401, { error: "Not signed in." }));
    await expect(promoRequest("GET", "/admin/customers")).rejects.toMatchObject({
      kind: "locked",
      message: "Not signed in.",
    });
    expect(onLocked).toHaveBeenCalledOnce();
  });

  it("passes the promo's own error message through", async () => {
    stubFetch(async () => json(500, { error: "Store unavailable." }));
    const error = await promoRequest("GET", "/admin/customers").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PromoError);
    expect(error).toMatchObject({ kind: "failed", status: 500, message: "Store unavailable." });
  });
});

describe("probePromo", () => {
  it("is unlocked when health answers, even with a 503 (the promo's config check)", async () => {
    stubFetch(async () => json(503, { ok: false }));
    await expect(probePromo()).resolves.toBe("unlocked");
  });

  it("is locked on a 401", async () => {
    stubFetch(async () => json(401, { error: "Not signed in." }));
    await expect(probePromo()).resolves.toBe("locked");
  });

  it("is unreachable when nothing answers", async () => {
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(probePromo()).resolves.toBe("unreachable");
  });
});

describe("unlock / lock", () => {
  it("unlocks with the password", async () => {
    const fetchFn = stubFetch(async () => json(200, { ok: true }));
    await unlockPromo("secret");
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("/promo-api/admin/login");
    expect(init.method).toBe("POST");
  });

  it("surfaces a wrong password", async () => {
    stubFetch(async () => json(401, { error: "Wrong password." }));
    await expect(unlockPromo("nope")).rejects.toMatchObject({ kind: "locked", message: "Wrong password." });
  });

  it("locks without ever throwing", async () => {
    const fetchFn = stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(lockPromo()).resolves.toBeUndefined();
    expect(fetchFn.mock.calls[0]![1].method).toBe("DELETE");
  });
});

describe("prospects", () => {
  it("lists them", async () => {
    stubFetch(async () => json(200, { customers: [{ id: "a", businessName: "A" }] }));
    await expect(listProspects()).resolves.toEqual([{ id: "a", businessName: "A" }]);
  });

  it("reads one, with the id encoded", async () => {
    const fetchFn = stubFetch(async () => json(200, { customer: { id: "a/b" }, calls: [] }));
    await expect(getProspect("a/b")).resolves.toEqual({ id: "a/b" });
    expect(fetchFn.mock.calls[0]![0]).toBe("/promo-api/admin/customers/a%2Fb");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/promoApi.test.ts`
Expected: FAIL — cannot resolve `../src/demos/api`.

- [ ] **Step 3: Implement the client**

Create `src/demos/api.ts`:
```ts
// The one place that knows where the promo backend is.
//
// Every request goes to the same-origin /promo-api prefix, which the dev and preview servers
// (vite.config.ts) forward to voiceagent_promo's /api — and, once deployed, a Vercel rewrite will.
// Same origin is what lets the promo's own httpOnly admin cookie work with no change on its side.
// When the promo backend moves into transcribe-backend, this file and the proxy entries change;
// nothing that calls these functions should have to.
export const PROMO_API = "/promo-api";

/**
 * What went wrong, in the three ways the UI treats differently:
 * - `unreachable` — nothing answered, or something other than the promo did (the proxy);
 * - `locked` — the promo refused us (401): its admin cookie is missing or expired;
 * - `failed` — the promo answered with an error of its own.
 */
export type PromoErrorKind = "unreachable" | "locked" | "failed";

export class PromoError extends Error {
  kind: PromoErrorKind;
  status: number;
  constructor(kind: PromoErrorKind, message: string, status: number) {
    super(message);
    this.name = "PromoError";
    this.kind = kind;
    this.status = status;
  }
}

// Told when any promo call comes back 401, so the Demos views can swap in the unlock card. It never
// signs anyone out of the dashboard: the two sign-ins are separate until the backend is merged.
let onLocked: (() => void) | null = null;
export function setPromoLockedHandler(handler: (() => void) | null): void {
  onLocked = handler;
}

export async function promoRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(`${PROMO_API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    throw new PromoError("unreachable", "Couldn't reach the demo service.", 0);
  }

  // The promo answers everything, errors included, with JSON. Anything else came from the proxy in
  // front of it: the promo isn't running, or the proxy points at the wrong place.
  const isJson = (res.headers.get("content-type") ?? "").includes("application/json");
  let data: { error?: string } | null = null;
  if (isJson) {
    try {
      data = (await res.json()) as { error?: string };
    } catch {
      data = null;
    }
  }
  if (data === null) {
    throw new PromoError("unreachable", `The demo service didn't answer (${res.status}).`, res.status);
  }

  if (res.status === 401) {
    onLocked?.();
    throw new PromoError("locked", data.error ?? "Demos are locked.", 401);
  }
  if (!res.ok) {
    throw new PromoError("failed", data.error ?? `Request failed (${res.status}).`, res.status);
  }
  return data as T;
}

export type PromoAccess = "unlocked" | "locked" | "unreachable";

/**
 * Whether this browser can use the demos right now. Any JSON answer from the admin health route
 * means the promo's auth let us through — including its 503, which only says the promo's own
 * config is incomplete (e.g. no research key), not that we're locked out.
 */
export async function probePromo(): Promise<PromoAccess> {
  try {
    await promoRequest("GET", "/admin/health");
    return "unlocked";
  } catch (error) {
    if (error instanceof PromoError) {
      if (error.kind === "locked") return "locked";
      if (error.kind === "unreachable") return "unreachable";
      return "unlocked";
    }
    return "unreachable";
  }
}

/** Sets the promo's own 7-day admin cookie on this origin. A wrong password is a `locked` error. */
export async function unlockPromo(password: string): Promise<void> {
  await promoRequest("POST", "/admin/login", { password });
}

/** Clears the promo cookie. Fire-and-forget: signing out must never fail because of the promo. */
export async function lockPromo(): Promise<void> {
  try {
    await promoRequest("DELETE", "/admin/login");
  } catch {
    /* already locked, or the promo isn't running — either way there's nothing left to clear */
  }
}

// The slice of the promo's customer record the stage-3 screens show. Stage 4 replaces this with
// the promo's full `Customer` type when its screens are ported.
export interface PromoProspect {
  id: string;
  businessName: string;
  status: "researching" | "ready" | "error";
  profile: { name: string; category: string };
}

export async function listProspects(): Promise<PromoProspect[]> {
  return (await promoRequest<{ customers: PromoProspect[] }>("GET", "/admin/customers")).customers;
}

export async function getProspect(id: string): Promise<PromoProspect> {
  const path = `/admin/customers/${encodeURIComponent(id)}`;
  return (await promoRequest<{ customer: PromoProspect }>("GET", path)).customer;
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run`
Expected: all pass (routing, promoApi, themeCore, styles).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no output.

- [ ] **Step 6: Files ready for review** (no commit)

---

### Task 4: Dev/preview proxy and a fake promo

**Files:**
- Modify: `vite.config.ts`, `.env.example`
- Create: `src/demos/env.d.ts`, `scripts/regression/fake_promo.py`

- [ ] **Step 1: Proxy config**

Overwrite `vite.config.ts` with:
```ts
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// Dev server on 5175 (the admin dashboard uses 5173 and the transcribe dashboard 5174, so all
// three can run at once).
//
// /promo-api and /promo-page go to voiceagent_promo (PROMO_API_URL — server-side only, so no VITE_
// prefix; default a local `npm run dev` on :3000). Proxying rather than calling it cross-origin
// keeps the promo's httpOnly admin cookie same-origin with no change to the promo. `vite preview`
// uses the same proxy. A deployed build needs the same two paths as Vercel rewrites (added at
// first deploy — see README).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const promo = (env.PROMO_API_URL || "http://localhost:3000").replace(/\/$/, "");
  const proxy = {
    "/promo-api": {
      target: promo,
      changeOrigin: true,
      rewrite: (path: string) => path.replace(/^\/promo-api/, "/api"),
    },
    "/promo-page": {
      target: promo,
      changeOrigin: true,
      rewrite: (path: string) => path.replace(/^\/promo-page/, ""),
    },
  };
  return {
    plugins: [react()],
    server: { port: 5175, proxy },
    preview: { proxy },
    // Shown on the "demo service unreachable" card in development, so a wrong target is obvious.
    define: { __PROMO_TARGET__: JSON.stringify(mode === "development" ? promo : "") },
  };
});
```
Create `src/demos/env.d.ts`:
```ts
/** The promo proxy target, set by vite.config.ts `define` — non-empty only in development. */
declare const __PROMO_TARGET__: string;
```
Append to `.env.example`:
```bash

# Where voiceagent_promo runs, for the /promo-api and /promo-page proxy (dev and `vite preview`).
# Server-side only — deliberately no VITE_ prefix. Default: a local `npm run dev` in the promo repo.
PROMO_API_URL=http://localhost:3000
```

- [ ] **Step 2: Build and typecheck**

Run: `npm run build`
Expected: clean.

- [ ] **Step 3: The fake promo**

Create `scripts/regression/fake_promo.py`:
```python
"""A stand-in for voiceagent_promo's API, for the Demos end-to-end check (demos_e2e.py).

Mirrors the real routes the dashboard uses, as they behave in the promo repo @ f482848:
- POST /api/admin/login {password} -> 200 {ok} + httpOnly admin_session cookie, or 401 {error}
- DELETE /api/admin/login -> 200 {ok}, clears the cookie
- every other /api/admin/* needs the cookie, else 401 {error: "Not signed in."} (its middleware)
- GET /api/admin/health -> 503 JSON (the promo's "config incomplete" answer — still signed in)
- GET /api/admin/customers -> {customers: [...]}; GET /api/admin/customers/<id> -> {customer, ...}
  or 404 {error: "Customer not found."}
Every response is JSON, as the promo's are. No state beyond the browser's cookie.
"""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

PORT = 8898
PASSWORD = "letmein"
COOKIE = "admin_session"
TOKEN = "valid-session"

PROSPECTS = [
    {"id": "pr0SPct1", "businessName": "Harbor Dental", "status": "ready",
     "profile": {"name": "Harbor Dental", "category": "Dentist"}},
    {"id": "cedar42", "businessName": "Cedar Bakery", "status": "researching",
     "profile": {"name": "", "category": ""}},
]


class _Server(ThreadingHTTPServer):
    allow_reuse_address = False
    daemon_threads = True


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, body: dict, cookie: str | None = None) -> None:
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        if cookie is not None:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(payload)

    def _signed_in(self) -> bool:
        raw = self.headers.get("cookie", "")
        pairs = dict(p.strip().split("=", 1) for p in raw.split(";") if "=" in p)
        return pairs.get(COOKIE) == TOKEN

    def _body(self) -> dict:
        length = int(self.headers.get("content-length") or 0)
        if not length:
            return {}
        try:
            return json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            return {}

    def _handle(self, method: str) -> None:
        path = urlparse(self.path).path
        if path == "/api/admin/login" and method == "POST":
            if self._body().get("password") == PASSWORD:
                self._send(200, {"ok": True},
                           f"{COOKIE}={TOKEN}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800")
            else:
                self._send(401, {"error": "Wrong password."})
            return
        if path == "/api/admin/login" and method == "DELETE":
            self._send(200, {"ok": True}, f"{COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0")
            return
        if path.startswith("/api/admin/") and not self._signed_in():
            self._send(401, {"error": "Not signed in."})
            return
        if path == "/api/admin/health" and method == "GET":
            self._send(503, {"ok": False, "version": "fake", "onVercel": False, "checks": {}})
            return
        if path == "/api/admin/customers" and method == "GET":
            self._send(200, {"customers": PROSPECTS})
            return
        prefix = "/api/admin/customers/"
        if path.startswith(prefix) and method == "GET":
            wanted = unquote(path[len(prefix):])
            match = next((p for p in PROSPECTS if p["id"] == wanted), None)
            if match is None:
                self._send(404, {"error": "Customer not found."})
            else:
                self._send(200, {"customer": match, "stats": {}, "calls": [], "events": [], "notes": []})
            return
        self._send(404, {"error": f"No fake for {method} {path}"})

    def do_GET(self):  # noqa: N802 — BaseHTTPRequestHandler naming
        self._handle("GET")

    def do_POST(self):  # noqa: N802
        self._handle("POST")

    def do_DELETE(self):  # noqa: N802
        self._handle("DELETE")

    def log_message(self, *_args):
        pass


def start(port: int = PORT) -> ThreadingHTTPServer:
    server = _Server(("127.0.0.1", port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


if __name__ == "__main__":
    srv = start()
    print(f"fake promo on http://127.0.0.1:{PORT} (password {PASSWORD!r}) — Ctrl+C to stop")
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        srv.shutdown()
```

- [ ] **Step 4: Smoke-test the proxy against the fake**

Run from APP (it builds, serves with `vite preview` on 5199 proxied to the fake on 8898, and stops
only the processes it started; ports 5199, 8898, 8899 must be free):
```bash
cd scripts/regression && python - <<'EOF'
import http.cookiejar, json, os, tempfile, urllib.request
from pathlib import Path
import fake_promo
from compare import APP_ROOT, NEW_PORT, OUT_DIR, build, serve, stop
OUT_DIR.mkdir(exist_ok=True)
promo = fake_promo.start()
os.environ["PROMO_API_URL"] = f"http://127.0.0.1:{fake_promo.PORT}"
with tempfile.TemporaryDirectory() as tmp:
    out = Path(tmp) / "app"
    build("proxy-smoke", APP_ROOT, out)
    proc, log = serve("proxy-smoke", APP_ROOT, out, NEW_PORT)
    try:
        base = f"http://127.0.0.1:{NEW_PORT}/promo-api"
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        def call(method, path, body=None):
            req = urllib.request.Request(base + path, method=method,
                                         data=None if body is None else json.dumps(body).encode(),
                                         headers={"content-type": "application/json"})
            try:
                with opener.open(req) as r:
                    return r.status, r.read()[:60]
            except urllib.error.HTTPError as e:
                return e.code, e.read()[:60]
        print(call("GET", "/admin/health"))
        print(call("POST", "/admin/login", {"password": fake_promo.PASSWORD}))
        print(call("GET", "/admin/customers"))
    finally:
        stop(proc, log)
        promo.shutdown(); promo.server_close()
EOF
```
Expected, in order: `(401, b'{"error": "Not signed in."}')`, `(200, b'{"ok": true}')`,
`(200, b'{"customers": [{"id": "pr0SPct1", …')` — the cookie set through the proxy is sent back
through it. Read `compare.py` first and adapt the `build`/`serve`/`stop` calls if their signatures
differ.

- [ ] **Step 5: Files ready for review** (no commit)

---

### Task 5: Promo sign-in state, the gate, and the Demos screens

**Files:**
- Create: `src/demos/views.ts`, `src/demos/PromoAuth.tsx`, `src/demos/DemosGate.tsx`, `src/demos/UnlockCard.tsx`, `src/demos/prospectStatus.ts`, `src/demos/pages/DemoPlaceholderPage.tsx`, `src/demos/pages/DemoProspectsPage.tsx`, `src/demos/pages/DemoProspectPage.tsx`, `src/demos/DemosView.tsx`

All of these are new and nothing imports them until Task 6, so the app is unchanged after this task. Styling: Tailwind utilities, used only **inside** the gate's `<div className="tw">` (the wrapper itself carries none). Cards follow the design system: outlined, `rounded-xl` (16px), no shadow.

- [ ] **Step 1: Which views are Demos views**

Create `src/demos/views.ts`:
```ts
import type { ViewId } from "../components/Sidebar";

// The admin-only Demos section. App uses this to pick the breadcrumb, hide the transcribe-only
// topbar controls, and render these views through the promo gate.
export const DEMO_VIEWS: ReadonlySet<ViewId> = new Set<ViewId>([
  "demoOverview",
  "demoProspects",
  "demoProspect",
  "demoPipeline",
]);
```

- [ ] **Step 2: The promo sign-in state**

Create `src/demos/PromoAuth.tsx`:
```tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { probePromo, setPromoLockedHandler, unlockPromo } from "./api";

// Whether the demos can be used, separately from the dashboard sign-in: the promo still has its
// own admin password until its backend moves into transcribe-backend.
//
// `idle` until a Demos view asks — the probe runs on the first visit, never on a dashboard load,
// so someone who only uses the transcribe screens never touches the promo at all.
export type PromoState = "idle" | "checking" | "locked" | "unlocked" | "unreachable";

interface PromoAuthValue {
  state: PromoState;
  /** Ask the promo again (first visit, or "Try again" after it was unreachable). */
  recheck: () => void;
  /** Throws a PromoError on a wrong password or an unreachable promo. */
  unlock: (password: string) => Promise<void>;
}

const PromoAuthContext = createContext<PromoAuthValue | null>(null);

export function PromoAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PromoState>("idle");

  const recheck = useCallback(() => {
    setState("checking");
    void probePromo().then(setState);
  }, []);

  const unlock = useCallback(async (password: string) => {
    await unlockPromo(password);
    setState("unlocked");
  }, []);

  // Any promo call that comes back 401 (the cookie expired mid-session) locks the demos again.
  useEffect(() => {
    setPromoLockedHandler(() => setState("locked"));
    return () => setPromoLockedHandler(null);
  }, []);

  const value = useMemo(() => ({ state, recheck, unlock }), [state, recheck, unlock]);
  return <PromoAuthContext.Provider value={value}>{children}</PromoAuthContext.Provider>;
}

export function usePromoAuth(): PromoAuthValue {
  const value = useContext(PromoAuthContext);
  if (!value) throw new Error("usePromoAuth must be used inside <PromoAuthProvider>");
  return value;
}
```

- [ ] **Step 3: The unlock card**

Create `src/demos/UnlockCard.tsx`:
```tsx
import { useState, type FormEvent } from "react";
import { PromoError } from "./api";
import { usePromoAuth } from "./PromoAuth";

// One password field for the promo's own admin password. Success sets the promo's 7-day cookie on
// this origin, so it's asked for once per browser, not once per visit.
export function UnlockCard() {
  const { unlock } = usePromoAuth();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await unlock(password);
    } catch (err) {
      setError(
        err instanceof PromoError
          ? err.kind === "unreachable"
            ? "Couldn't reach the demo service. Try again in a moment."
            : err.message
          : "Something went wrong. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="max-w-md rounded-xl border bg-card p-6">
      <h2 className="ta-headline-1 text-foreground">Unlock demos</h2>
      <p className="ta-body-2 mt-1 text-muted-foreground">
        The demos run on the promo app, which has its own admin password. Enter it once on this
        browser and it stays unlocked for 7 days.
      </p>
      <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="ta-label-1 text-foreground">Promo password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="ta-body-2 h-10 rounded-lg border border-input bg-background px-3 text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          />
        </label>
        {error && (
          <p role="alert" className="ta-body-2 text-destructive">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || !password}
          className="ta-label-1 h-10 rounded-lg bg-primary px-4 text-primary-foreground transition-colors hover:bg-primary-strong disabled:opacity-50"
        >
          {busy ? "Unlocking…" : "Unlock demos"}
        </button>
      </form>
    </section>
  );
}
```

- [ ] **Step 4: The gate**

Create `src/demos/DemosGate.tsx`:
```tsx
import { useEffect, type ReactNode } from "react";
import { usePromoAuth } from "./PromoAuth";
import { UnlockCard } from "./UnlockCard";

// Everything in the Demos section renders through here: it asks the promo on the first visit and
// shows the unlock card, an "unreachable" card, or the view. It is also the `.tw` boundary — the
// promo's Tailwind styling applies inside this element and nowhere else. The wrapper itself stays
// bare (inside @scope a utility can't style the scope root).
export function DemosGate({ children }: { children: ReactNode }) {
  const { state, recheck } = usePromoAuth();

  useEffect(() => {
    if (state === "idle") recheck();
  }, [state, recheck]);

  return (
    <div className="tw">
      {(state === "idle" || state === "checking") && (
        <p className="ta-body-2 text-muted-foreground">Checking the demo service…</p>
      )}
      {state === "locked" && <UnlockCard />}
      {state === "unreachable" && (
        <section className="max-w-lg rounded-xl border bg-card p-6">
          <h2 className="ta-headline-1 text-foreground">Demo service unreachable</h2>
          <p className="ta-body-2 mt-1 text-muted-foreground">
            The demos come from the promo app, and it didn't answer. Check that it's running, then
            try again.
          </p>
          {__PROMO_TARGET__ && (
            <p className="ta-caption-1 mt-2 text-muted-foreground">
              Dev proxy target: {__PROMO_TARGET__} (set PROMO_API_URL to change it)
            </p>
          )}
          <button
            type="button"
            onClick={recheck}
            className="ta-label-1 mt-4 h-10 rounded-lg border px-4 text-foreground transition-colors hover:bg-accent"
          >
            Try again
          </button>
        </section>
      )}
      {state === "unlocked" && children}
    </div>
  );
}
```

- [ ] **Step 5: Status labels and the placeholder page**

Create `src/demos/prospectStatus.ts`:
```ts
import type { PromoProspect } from "./api";

export const PROSPECT_STATUS_LABEL: Record<PromoProspect["status"], string> = {
  researching: "Researching",
  ready: "Ready",
  error: "Error",
};
```
Create `src/demos/pages/DemoPlaceholderPage.tsx`:
```tsx
// Stands in for a Demos screen that is ported from the promo app in stage 4.
export function DemoPlaceholderPage({ title, body }: { title: string; body: string }) {
  return (
    <section className="rounded-xl border bg-card px-6 py-5">
      <h2 className="ta-headline-2 text-foreground">{title}</h2>
      <p className="ta-body-2 mt-1 text-muted-foreground">{body}</p>
    </section>
  );
}
```

- [ ] **Step 6: The prospects list**

Create `src/demos/pages/DemoProspectsPage.tsx`:
```tsx
import { useEffect, useState } from "react";
import { listProspects, PromoError, type PromoProspect } from "../api";
import { PROSPECT_STATUS_LABEL } from "../prospectStatus";

// Every business with a demo link, read through the proxy. A stage-3 stand-in for the promo's
// Customers table: enough to prove the proxy, the cookie and the record-id route end to end.
export function DemoProspectsPage({ onOpen }: { onOpen: (id: string) => void }) {
  const [prospects, setProspects] = useState<PromoProspect[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listProspects()
      .then((list) => active && setProspects(list))
      .catch((err: unknown) => {
        if (!active) return;
        // A 401 is the gate's job (it swaps in the unlock card); anything else is shown here.
        if (err instanceof PromoError && err.kind === "locked") return;
        setError(err instanceof Error ? err.message : "Couldn't load prospects.");
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="rounded-xl border bg-card">
      <header className="border-b px-6 py-4">
        <h2 className="ta-headline-2 text-foreground">Prospects</h2>
        <p className="ta-caption-1 mt-1 text-muted-foreground">
          Every business with a demo link. The full editor arrives in the next stage.
        </p>
      </header>
      {error ? (
        <p role="alert" className="ta-body-2 px-6 py-4 text-destructive">
          {error}
        </p>
      ) : !prospects ? (
        <p className="ta-body-2 px-6 py-4 text-muted-foreground">Loading prospects…</p>
      ) : prospects.length === 0 ? (
        <p className="ta-body-2 px-6 py-4 text-muted-foreground">No prospects yet.</p>
      ) : (
        <ul>
          {prospects.map((p) => (
            <li key={p.id} className="border-t first:border-t-0">
              <button
                type="button"
                onClick={() => onOpen(p.id)}
                className="flex w-full items-center justify-between gap-4 px-6 py-3 text-left transition-colors hover:bg-accent"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="ta-label-1 truncate text-foreground">{p.profile.name || p.businessName}</span>
                  <span className="ta-caption-1 text-muted-foreground">{p.profile.category || "No category yet"}</span>
                </span>
                <span className="ta-caption-1 shrink-0 text-muted-foreground">{PROSPECT_STATUS_LABEL[p.status]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 7: One prospect**

Create `src/demos/pages/DemoProspectPage.tsx`:
```tsx
import { useEffect, useState } from "react";
import { getProspect, PromoError, type PromoProspect } from "../api";
import { PROSPECT_STATUS_LABEL } from "../prospectStatus";

// One prospect, addressed by id in the URL (#/demos/prospects/<id>) so it survives a refresh and
// can be linked. A stage-3 stand-in for the promo's customer detail page.
export function DemoProspectPage({ id, onBack }: { id: string; onBack: () => void }) {
  const [prospect, setProspect] = useState<PromoProspect | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setProspect(null);
    setError(null);
    getProspect(id)
      .then((p) => active && setProspect(p))
      .catch((err: unknown) => {
        if (!active) return;
        if (err instanceof PromoError && err.kind === "locked") return; // the gate handles it
        setError(
          err instanceof PromoError && err.status === 404
            ? "That prospect doesn't exist."
            : err instanceof Error
              ? err.message
              : "Couldn't load this prospect.",
        );
      });
    return () => {
      active = false;
    };
  }, [id]);

  return (
    <div className="flex flex-col gap-4">
      <button type="button" onClick={onBack} className="ta-label-1 self-start text-primary hover:underline">
        ← All prospects
      </button>
      <section className="rounded-xl border bg-card px-6 py-5">
        {error ? (
          <p role="alert" className="ta-body-2 text-destructive">
            {error}
          </p>
        ) : !prospect ? (
          <p className="ta-body-2 text-muted-foreground">Loading…</p>
        ) : (
          <>
            <h2 className="ta-title-3 text-foreground">{prospect.profile.name || prospect.businessName}</h2>
            <p className="ta-body-2 mt-1 text-muted-foreground">
              {prospect.profile.category || "No category yet"} · {PROSPECT_STATUS_LABEL[prospect.status]}
            </p>
            <p className="ta-caption-1 mt-4 text-muted-foreground">
              Knowledge, prompts, sources, sharing and test calls arrive in the next stage.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 8: The Demos view switch**

Create `src/demos/DemosView.tsx`:
```tsx
import type { ViewId } from "../components/Sidebar";
import { DemosGate } from "./DemosGate";
import { DemoPlaceholderPage } from "./pages/DemoPlaceholderPage";
import { DemoProspectPage } from "./pages/DemoProspectPage";
import { DemoProspectsPage } from "./pages/DemoProspectsPage";

// Which Demos screen to show for a route. Everything goes through the gate (promo sign-in + the
// .tw styling boundary).
export function DemosView({
  view,
  id,
  onOpenProspect,
  onShowProspects,
}: {
  view: ViewId;
  id: string | undefined;
  onOpenProspect: (id: string) => void;
  onShowProspects: () => void;
}) {
  return (
    <DemosGate>
      {view === "demoOverview" && (
        <DemoPlaceholderPage
          title="Demo overview"
          body="Calls per day, top prospects by minutes and recent calls from the promo app arrive in the next stage."
        />
      )}
      {view === "demoProspects" && <DemoProspectsPage onOpen={onOpenProspect} />}
      {view === "demoProspect" &&
        (id ? <DemoProspectPage id={id} onBack={onShowProspects} /> : <DemoProspectsPage onOpen={onOpenProspect} />)}
      {view === "demoPipeline" && (
        <DemoPlaceholderPage
          title="Pipeline"
          body="The CRM board, every prospect by stage with the activity feed beside it, arrives in the next stage."
        />
      )}
    </DemosGate>
  );
}
```

- [ ] **Step 9: Typecheck, lint-by-build, tests**

Run: `npm run build && npx vitest run`
Expected: clean build (unused-module warnings are not errors; nothing imports these yet); all tests pass.

- [ ] **Step 10: Files ready for review** (no commit)

---

### Task 6: Wire the Demos section into the dashboard

**Files:**
- Modify: `src/icons.tsx`, `src/components/Sidebar.tsx`, `src/App.tsx`

- [ ] **Step 1: An icon for the demo overview**

In `src/icons.tsx`, after `IconPhone`, add (lucide "presentation"):
```tsx
export const IconPresentation = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2 3h20" />
    <path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3" />
    <path d="m7 21 5-5 5 5" />
  </Icon>
);
```

- [ ] **Step 2: The Demos nav group**

In `src/components/Sidebar.tsx`:
1. Add `IconColumns`, `IconPresentation` and `IconTable` to the import from `"../icons"` (keep the list's existing order style).
2. Give every group a `key`, and add the Demos group after "Runs". The `NAV` type and data become:
```ts
const NAV: {
  key: string;
  group: string;
  items: { id: ViewId; label: string; icon: typeof IconOverview; adminOnly?: boolean }[];
}[] = [
  {
    key: "dashboard",
    group: "Dashboard",
    items: [
      { id: "overview", label: "Overview", icon: IconOverview },
      { id: "analytics", label: "Analytics", icon: IconAnalytics },
      { id: "people", label: "Per person", icon: IconUsers, adminOnly: true },
      { id: "activity", label: "Daily activity", icon: IconActivity },
    ],
  },
  {
    key: "runs",
    group: "Runs",
    items: [
      { id: "runs", label: "All runs", icon: IconRuns },
      { id: "failed", label: "Failed runs", icon: IconAlert, adminOnly: true },
    ],
  },
  {
    key: "demos",
    group: "Demos",
    items: [
      { id: "demoOverview", label: "Demo overview", icon: IconPresentation, adminOnly: true },
      { id: "demoProspects", label: "Prospects", icon: IconTable, adminOnly: true },
      { id: "demoPipeline", label: "Pipeline", icon: IconColumns, adminOnly: true },
    ],
  },
  {
    key: "feedback",
    group: "Feedback",
    items: [
      { id: "feedback", label: "Send feedback", icon: IconMessage },
      { id: "allFeedback", label: "All feedback", icon: IconInbox, adminOnly: true },
    ],
  },
  {
    key: "settings",
    group: "Settings",
    items: [
      { id: "calls", label: "Answered calls", icon: IconPhone },
      { id: "business", label: "Business information", icon: IconIdea },
      { id: "numbers", label: "Agent numbers", icon: IconPhone, adminOnly: true },
      { id: "apiKeys", label: "API keys", icon: IconKey, adminOnly: true },
      { id: "accounts", label: "Accounts", icon: IconUsers, adminOnly: true },
    ],
  },
];
```
3. In the render, change `<div className="sidebar-group" key={section.group}>` to `<div className="sidebar-group" key={section.key} data-group={section.key}>`.
4. A prospect's page belongs to Prospects in the nav. Directly inside `{items.map((item) => {`, before `const ItemIcon = item.icon;`, add:
```ts
            // A prospect's own page highlights "Prospects": it's where you came from and go back to.
            const isActive = item.id === active || (item.id === "demoProspects" && active === "demoProspect");
```
and replace both `item.id === active` uses in that button (`className` and `aria-current`) with `isActive`.

- [ ] **Step 3: App wiring**

In `src/App.tsx`:
1. Imports — add:
```ts
import { lockPromo } from "./demos/api";
import { DemosView } from "./demos/DemosView";
import { PromoAuthProvider } from "./demos/PromoAuth";
import { DEMO_VIEWS } from "./demos/views";
```
2. `STANDALONE_VIEWS` — add `"demoOverview", "demoProspects", "demoProspect", "demoPipeline",` (they never read `/transcribe/stats`).
3. In `Dashboard`, change `const [{ view, mailbox: routeMailbox }, navigate] = useRoute();` to
```ts
  const [{ view, mailbox: routeMailbox, id: routeId }, navigate] = useRoute();
  const isDemoView = DEMO_VIEWS.has(view);
```
4. After the `openView` function, add:
```ts
  // Signing out of the dashboard also clears the promo's cookie on this browser, so the next person
  // at this machine has to unlock the demos themselves. Fire-and-forget: it never blocks sign-out.
  const signOutEverywhere = useCallback(() => {
    void lockPromo();
    onSignOut();
  }, [onSignOut]);
```
and pass `signOutEverywhere` instead of `onSignOut` to `<Sidebar onSignOut=…>` and `<AccountsPage onSignOut=…>`.
5. Wrap the returned `<div className="app" …>…</div>` in `<PromoAuthProvider>…</PromoAuthProvider>` (the provider lives only while signed in, so signing out resets the demos state).
6. Breadcrumb: change `<span className="muted">Transcribe</span>` to `<span className="muted">{isDemoView ? "Demos" : "Transcribe"}</span>`.
7. Topbar actions: the mailbox picker and Refresh only concern transcribe views. Change
`{isAdmin && <MailboxPicker value={mailbox} onChange={setMailbox} />}` to
`{isAdmin && !isDemoView && <MailboxPicker value={mailbox} onChange={setMailbox} />}`, and wrap the Refresh `<button …>…</button>` in `{!isDemoView && ( … )}`.
8. In `<main className="content">`, after the `accounts` block, add:
```tsx
          {isDemoView &&
            (isAdmin ? (
              <DemosView
                view={view}
                id={routeId}
                onOpenProspect={(id) => navigate({ view: "demoProspect", id })}
                onShowProspects={() => navigate({ view: "demoProspects" })}
              />
            ) : (
              <p className="muted ta-body-2">Only an admin can see the demos.</p>
            ))}
```

- [ ] **Step 4: Build, tests, regression**

Run: `npm run build && npx vitest run`
Expected: clean; all tests pass.
Run: `python scripts/regression/compare.py`
Expected: `44 captures compared; …`, `expected changes confirmed: admin:apiKeys:light`, `IDENTICAL`. (The Demos group is hidden by `HIDE`; everything else — including every user capture, where the group is never rendered — must match.) If it isn't identical, read `.regression/diff.txt`: a difference in an admin capture's sidebar other than the hidden group means the change leaked (e.g. an extra wrapper); fix it in the app, never by widening `HIDE`.

- [ ] **Step 5: Files ready for review** (no commit)

---

### Task 7: End-to-end check of the Demos path

**Files:**
- Create: `scripts/regression/demos_e2e.py`
- Modify: `scripts/regression/README.md`

Builds APP, serves it with `vite preview` proxied to `fake_promo.py`, signs in against `fake_backend.py`, and walks the whole path in Edge.

- [ ] **Step 1: Write the script**

Create `scripts/regression/demos_e2e.py`:
```python
"""End-to-end check of the Demos section: proxy, promo cookie, unlock card, record-id routes.

    python scripts/regression/demos_e2e.py      (from tecace-voice-agent-dashboard/)

Builds this app, serves it with `vite preview` (whose proxy sends /promo-api to fake_promo.py),
signs in against fake_backend.py and walks the flow in Edge. Exit 0 = all checks pass,
1 = failures listed, 2 = harness failure. Needs ports 5199, 8898 and 8899 free.
"""

from __future__ import annotations

import os
import re
import socket
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

import fake_backend
import fake_promo
from compare import APP_ROOT, BACKEND_PORT, NEW_PORT, OUT_DIR, HarnessError, build, serve, settle, stop


class Checks:
    def __init__(self) -> None:
        self.failed: list[str] = []

    def __call__(self, name: str, ok: bool, detail: str = "") -> None:
        print(f"  {'ok  ' if ok else 'FAIL'} {name}" + (f" ({detail})" if detail and not ok else ""))
        if not ok:
            self.failed.append(name)


def port_in_use(port: int) -> bool:
    with socket.socket() as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


def restart_promo():
    # Windows can hold the port for a moment after the old server closed; retry briefly.
    for _ in range(20):
        try:
            return fake_promo.start()
        except OSError:
            time.sleep(0.5)
    raise HarnessError(f"couldn't restart the fake promo on port {fake_promo.PORT}")


def open_page(browser, token: str | None, url: str, promo_requests: list[str], page_errors: list[str]):
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, reduced_motion="reduce")
    init = ["try { localStorage.clear(); } catch (e) {}", "localStorage.setItem('theme', 'light');"]
    if token:
        init.append(f"localStorage.setItem('transcribe.token', '{token}');")
    ctx.add_init_script("\n".join(init))
    page = ctx.new_page()
    page.route("**/favicon.ico", lambda r: r.fulfill(status=204))
    page.on("request", lambda r: promo_requests.append(f"{r.method} {urlparse(r.url).path}")
            if "/promo-" in r.url else None)
    page.on("pageerror", lambda e: page_errors.append(str(e)))
    page.goto(url)
    settle(page)
    return ctx, page


def run() -> int:
    for port in (NEW_PORT, BACKEND_PORT, fake_promo.PORT):
        if port_in_use(port):
            raise HarnessError(f"port {port} in use")
    OUT_DIR.mkdir(exist_ok=True)
    check = Checks()
    page_errors: list[str] = []
    backend = fake_backend.start(BACKEND_PORT)
    promo = fake_promo.start()
    os.environ["PROMO_API_URL"] = f"http://127.0.0.1:{fake_promo.PORT}"  # read by vite preview's proxy
    try:
        with tempfile.TemporaryDirectory(prefix="demos-e2e-") as tmp:
            out = Path(tmp) / "app"
            build("demos-e2e", APP_ROOT, out)
            proc, log = serve("demos-e2e", APP_ROOT, out, NEW_PORT)
            base = f"http://127.0.0.1:{NEW_PORT}/"
            try:
                with sync_playwright() as p:
                    browser = p.chromium.launch(channel="msedge")

                    # A user never sees the Demos section, and asking for it by URL is refused
                    # without the promo ever being contacted.
                    reqs: list[str] = []
                    ctx, page = open_page(browser, "tok-user", base + "#/demos/prospects", reqs, page_errors)
                    check("user: no Demos group in the sidebar",
                          page.locator('.sidebar-group[data-group="demos"]').count() == 0)
                    check("user: a Demos URL is refused",
                          "Only an admin can see the demos." in page.locator("main").inner_text())
                    check("user: the promo is never contacted", reqs == [], str(reqs))
                    ctx.close()

                    # Admin: the group is there, and a transcribe view doesn't touch the promo.
                    reqs = []
                    ctx, page = open_page(browser, "tok-admin", base + "#/overview", reqs, page_errors)
                    check("admin: Demos group with three items",
                          page.locator('.sidebar-group[data-group="demos"] .nav-item').count() == 3)
                    check("admin: no promo request on a transcribe view", reqs == [], str(reqs))

                    page.get_by_role("button", name="Prospects", exact=True).click()
                    page.get_by_role("heading", name="Unlock demos").wait_for()
                    check("Prospects opens #/demos/prospects", page.evaluate("location.hash") == "#/demos/prospects")
                    check("locked: the unlock card is shown", True)
                    check("only the health probe was sent while locked",
                          reqs == ["GET /promo-api/admin/health"], str(reqs))
                    check("breadcrumb says Demos", page.locator(".crumbs").inner_text().startswith("Demos"))
                    check("no mailbox picker or Refresh on Demos views",
                          page.locator(".mailbox-picker").count() == 0
                          and page.get_by_role("button", name="Refresh").count() == 0)
                    check("Demos render inside one .tw wrapper", page.locator("main .tw").count() == 1)
                    unlock_bg = page.get_by_role("button", name="Unlock demos").evaluate(
                        "e => getComputedStyle(e).backgroundColor")
                    check("unlock button is brand blue", unlock_bg == "rgb(17, 109, 255)", unlock_bg)

                    page.get_by_label("Promo password").fill("wrong")
                    page.get_by_role("button", name="Unlock demos").click()
                    page.get_by_role("alert").wait_for()
                    check("a wrong password is rejected", "Wrong password." in page.get_by_role("alert").inner_text())

                    page.get_by_label("Promo password").fill(fake_promo.PASSWORD)
                    page.get_by_role("button", name="Unlock demos").click()
                    page.get_by_text("Harbor Dental").first.wait_for()
                    check("unlocked: prospects are listed",
                          page.get_by_text("Harbor Dental").first.is_visible()
                          and page.get_by_text("Researching").first.is_visible())

                    page.get_by_role("button", name=re.compile("Harbor Dental")).click()
                    page.get_by_role("heading", name="Harbor Dental").wait_for()
                    check("a prospect gets its own URL",
                          page.evaluate("location.hash") == "#/demos/prospects/pr0SPct1",
                          page.evaluate("location.hash"))
                    check("Prospects stays highlighted on a prospect",
                          page.locator(".nav-item.is-active").inner_text().strip() == "Prospects")

                    page.reload()
                    settle(page)
                    page.get_by_role("heading", name="Harbor Dental").wait_for()
                    check("refresh keeps the prospect", True)
                    check("refresh stays unlocked (the promo cookie was kept)",
                          page.get_by_role("heading", name="Unlock demos").count() == 0)

                    page.goto(base + "#/demos/prospects/nope")
                    page.reload()
                    settle(page)
                    page.get_by_role("alert").wait_for()
                    check("an unknown prospect says so",
                          "That prospect doesn't exist." in page.get_by_role("alert").inner_text())

                    page.goto(base + "#/apiKeys")
                    page.reload()
                    settle(page)
                    check("#/apiKeys survives a refresh",
                          page.get_by_text("Let another system read call minutes").is_visible())

                    reqs.clear()
                    page.get_by_title("Sign out").click()
                    settle(page)
                    check("sign-out also locks the demos", "DELETE /promo-api/admin/login" in reqs, str(reqs))
                    ctx.close()

                    # The promo is down: an honest card, and "Try again" recovers once it's back.
                    promo.shutdown()
                    promo.server_close()
                    reqs = []
                    ctx, page = open_page(browser, "tok-admin", base + "#/demos/overview", reqs, page_errors)
                    page.get_by_role("heading", name="Demo service unreachable").wait_for()
                    check("promo down: the unreachable card is shown", True)
                    promo = restart_promo()
                    page.get_by_role("button", name="Try again").click()
                    page.get_by_role("heading", name="Unlock demos").wait_for()
                    check("Try again recovers once the promo is back", True)
                    ctx.close()

                    check("no page errors", page_errors == [], str(page_errors))
                    browser.close()
            finally:
                stop(proc, log)
    finally:
        backend.shutdown()
        backend.server_close()
        promo.shutdown()
        promo.server_close()

    print(f"\n{len(check.failed)} failing checks" if check.failed else "\nALL DEMOS CHECKS PASS")
    return 1 if check.failed else 0


def main() -> int:
    try:
        return run()
    except Exception as exc:  # noqa: BLE001 — any harness problem is exit 2, never a pass
        print(f"HARNESS FAILURE: {type(exc).__name__}: {exc}")
        return 2


if __name__ == "__main__":
    sys.exit(main())
```
Before running, read `compare.py` to confirm the imported names and the `build`/`serve`/`stop`/`settle` signatures match what's used above (`build(label, app_dir, out)`, `serve(label, app_dir, out, port) -> (proc, log)`, `stop(proc, log)`, `settle(page)`); adapt the calls if a signature differs, and say so in your report.

- [ ] **Step 2: Run it**

Run: `python scripts/regression/demos_e2e.py`
Expected: every line `ok`, then `ALL DEMOS CHECKS PASS`, exit 0.
Notes if something fails:
- "only the health probe was sent while locked" failing with two health requests: React StrictMode doesn't apply to a production build, so a second probe means the gate's effect re-ran — check `recheck`'s dependencies before touching the check.
- Unlock succeeds but the list 401s: the cookie isn't coming back through the proxy — inspect `Set-Cookie` on the login response in the preview log; `changeOrigin` must not rewrite the cookie's attributes (the fake sets no Domain).
- The unreachable card never shows: see what `vite preview` answers for `/promo-api/admin/health` when nothing listens on 8898 (`curl -i`); `api.ts` must classify it as `unreachable` — if Vite answers with JSON, report it rather than loosening the check.

- [ ] **Step 3: Document it**

In `scripts/regression/README.md`, add:
```markdown
## demos_e2e.py

    python scripts/regression/demos_e2e.py

Builds this app, serves it with `vite preview` proxied (`PROMO_API_URL`) to `fake_promo.py` — a
stand-in for voiceagent_promo's admin API — and walks the Demos section in Edge: a user never sees
it; an admin unlocks it (wrong password rejected), lists prospects, opens one by URL, refreshes
and stays unlocked; `#/apiKeys` survives a refresh; signing out clears the promo cookie; a promo
that's down shows the "unreachable" card and "Try again" recovers. Exit 0/1/2 like the others.
Needs ports 5199, 8898 and 8899 free — don't run it at the same time as `compare.py`.
```

- [ ] **Step 4: Files ready for review** (no commit)

---

### Task 8: Documentation

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `docs/superpowers/specs/2026-09-21-combined-dashboard-design.md`

- [ ] **Step 1: `CLAUDE.md`**

Add a section before "## Proving nothing broke":
```markdown
## The Demos section (promo)

- `src/demos/api.ts` is the only code that knows where the promo backend is: same-origin
  `/promo-api/*`, proxied to voiceagent_promo's `/api/*` (`vite.config.ts`, `PROMO_API_URL`).
  Every promo call goes through `promoRequest`; its errors are `unreachable` / `locked` / `failed`.
- The promo has its own admin password until its backend is merged. `PromoAuth` holds that state
  (probed on the first Demos visit only); `DemosGate` shows the unlock or unreachable card and is
  the `.tw` boundary for everything in the section. A promo 401 re-locks the demos; it never signs
  anyone out of the dashboard. Dashboard sign-out also clears the promo cookie.
- Routes live in `src/routing.ts` `PATHS` (a `Record<ViewId, string>` — add every new view there;
  `:id` marks a record segment, e.g. `demos/prospects/:id`). `DEMO_VIEWS` lists the Demos views.
```
And add to "## Proving nothing broke": `- python scripts/regression/demos_e2e.py — walks the Demos section against a fake promo.`

- [ ] **Step 2: `README.md`**

Replace the "## Run" block's first code block with:
```sh
cp .env.example .env   # set VITE_BACKEND_URL (transcribe-backend) and PROMO_API_URL (voiceagent_promo)
npm install
npm run dev            # http://localhost:5175
```
and add after the bullet list:
```markdown
## The promo (Demos section)

Demos screens talk to voiceagent_promo through `/promo-api`, proxied by the dev and preview servers
to `PROMO_API_URL` (default `http://localhost:3000` — run `npm run dev` in the promo repo). The
promo's admin password unlocks them once per browser.

**Before the first deploy:** Vercel doesn't run the Vite proxy, so `vercel.json` needs two
rewrites, above the SPA fallback, pointing at the promo's deployed origin:
`/promo-api/:path*` → `<promo>/api/:path*` and `/promo-page/:path*` → `<promo>/:path*`.
```

- [ ] **Step 3: Spec note**

In `docs/superpowers/specs/2026-09-21-combined-dashboard-design.md`, section 5, under the `prod:` bullet, add a sub-bullet: `- Deferred at stage 3 (2026-09-21): the promo's deployed URL isn't settled, so only the dev/preview proxy is wired; the README lists the two rewrites to add at first deploy.`

- [ ] **Step 4: Final checks**

Run, one after another:
```bash
npx vitest run && npm run build && python scripts/regression/compare.py && python scripts/regression/tw_probe.py && python scripts/regression/demos_e2e.py
```
Expected: all tests pass; build clean; `IDENTICAL` with `expected changes confirmed: admin:apiKeys:light`; `ALL PROBE CHECKS PASS`; `ALL DEMOS CHECKS PASS`.

- [ ] **Step 5: Files ready for review** (no commit) — **Stage 3 done.**
