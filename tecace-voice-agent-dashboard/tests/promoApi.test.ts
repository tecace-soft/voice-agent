import { afterEach, describe, expect, it, vi } from "vitest";
import {
  lockPromo,
  probePromo,
  promoFetch,
  PromoError,
  promoRequest,
  promoUrl,
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

  it("calls it unreachable when a gateway (not the promo) answers 502", async () => {
    stubFetch(async () => new Response("Bad Gateway", { status: 502, headers: { "content-type": "text/plain" } }));
    await expect(promoRequest("GET", "/admin/health")).rejects.toMatchObject({ kind: "unreachable", status: 502 });
  });

  it("calls it failed (not unreachable) on a non-JSON answer that isn't a gateway error", async () => {
    stubFetch(async () => new Response("<html>Not Found</html>", { status: 404, headers: { "content-type": "text/html" } }));
    await expect(promoRequest("GET", "/admin/customers")).rejects.toMatchObject({
      kind: "failed",
      status: 404,
      message: "The demo service sent an unexpected response (404).",
    });
  });

  it("returns undefined on a 204", async () => {
    stubFetch(async () => new Response(null, { status: 204 }));
    await expect(promoRequest("DELETE", "/admin/login")).resolves.toBeUndefined();
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

  it("is unlocked when health answers 200", async () => {
    stubFetch(async () => json(200, { ok: true, version: "x", onVercel: false, checks: {} }));
    await expect(probePromo()).resolves.toBe("unlocked");
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

// Only an answer that really came from the promo (a JSON object) proves its auth let us through. An
// SPA fallback serving index.html (a deploy without the /promo-api rewrite), or some other server
// on PROMO_API_URL, must read as "unreachable" — not as unlocked.
describe("probePromo — who answered", () => {
  it("is unreachable when the SPA fallback answers with index.html", async () => {
    stubFetch(async () => new Response("<!doctype html>", { status: 200, headers: { "content-type": "text/html" } }));
    await expect(probePromo()).resolves.toBe("unreachable");
  });

  it("is unreachable when another server answers with an HTML 404", async () => {
    stubFetch(async () => new Response("<h1>Not found</h1>", { status: 404, headers: { "content-type": "text/html" } }));
    await expect(probePromo()).resolves.toBe("unreachable");
  });

  it("is unlocked when the promo itself answers with a JSON error past its auth", async () => {
    stubFetch(async () => json(500, { error: "Store unavailable." }));
    await expect(probePromo()).resolves.toBe("unlocked");
  });

  it("marks errors by whether the promo sent them", async () => {
    stubFetch(async () => json(500, { error: "Store unavailable." }));
    await expect(promoRequest("GET", "/admin/customers")).rejects.toMatchObject({ fromPromo: true });
    stubFetch(async () => new Response("<h1>Not found</h1>", { status: 404, headers: { "content-type": "text/html" } }));
    await expect(promoRequest("GET", "/admin/customers")).rejects.toMatchObject({ kind: "failed", fromPromo: false });
  });
});

// promoFetch is the drop-in the ported promo screens use in place of fetch("/api/…"): same Response
// back (their own readJson still reads it), routed through the proxy, with 401s reported to the gate.
describe("promoFetch", () => {
  it("routes /api/… through /promo-api with the cookie and passes init through", async () => {
    const fetchFn = stubFetch(async () => json(200, { customers: [] }));
    const res = await promoFetch("/api/admin/customers", { method: "PATCH", body: "{}" });
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("/promo-api/admin/customers");
    expect(init.method).toBe("PATCH");
    expect(init.body).toBe("{}");
    expect(init.credentials).toBe("same-origin");
    expect(res.status).toBe(200);
  });

  it("reports a 401 to the gate and still returns the response", async () => {
    const onLocked = vi.fn();
    setPromoLockedHandler(onLocked);
    stubFetch(async () => json(401, { error: "Not signed in." }));
    const res = await promoFetch("/api/admin/customers");
    expect(res.status).toBe(401);
    expect(onLocked).toHaveBeenCalledOnce();
  });

  it("turns a network failure into a readable error", async () => {
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(promoFetch("/api/admin/customers")).rejects.toThrow("Couldn't reach the demo service.");
  });

  it("refuses anything that isn't a promo /api/ path", async () => {
    stubFetch(async () => json(200, {}));
    await expect(promoFetch("https://example.com/api/x")).rejects.toThrow(/only takes \/api\//);
  });
});

describe("promoUrl", () => {
  it("maps a promo /api/ path onto the proxy", () => {
    expect(promoUrl("/api/calls/abc123")).toBe("/promo-api/calls/abc123");
  });

  it("refuses anything that isn't a promo /api/ path", () => {
    expect(() => promoUrl("https://example.com/api/x")).toThrow(/only takes \/api\//);
  });
});
