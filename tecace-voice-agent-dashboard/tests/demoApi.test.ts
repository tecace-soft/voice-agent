import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoFetch } from "../src/demos/api";
import { setToken } from "../src/api/backend";

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

beforeEach(() => {
  setToken(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setToken(null);
});

// demoFetch is the drop-in the ported promo screens use in place of fetch("/api/…"): it returns the
// Response untouched (their own readJson still reads it), and it goes to transcribe-backend's
// /demo/* with the dashboard's own admin bearer token — no proxy, no promo cookie.
describe("demoFetch", () => {
  it("puts the path under the backend's /demo base and passes init through", async () => {
    const fetchFn = stubFetch(async () => json(200, { customers: [] }));
    const res = await demoFetch("/customers", { method: "PATCH", body: "{}" });
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("/demo/customers"); // __BACKEND_URL__ is "" under vitest
    expect(init.method).toBe("PATCH");
    expect(init.body).toBe("{}");
    expect(res.status).toBe(200);
  });

  it("sends the dashboard's bearer token when there is one", async () => {
    const fetchFn = stubFetch(async () => json(200, {}));
    setToken("tok-123");
    await demoFetch("/analytics?days=7");
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("/demo/analytics?days=7");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer tok-123");
  });

  it("sends no authorization header when signed out", async () => {
    const fetchFn = stubFetch(async () => json(200, {}));
    await demoFetch("/customers");
    const [, init] = fetchFn.mock.calls[0]!;
    expect(new Headers(init.headers).get("authorization")).toBeNull();
    expect(new Headers(init.headers).get("accept")).toBe("application/json");
  });

  it("adds a JSON content type only when there is a body", async () => {
    const fetchFn = stubFetch(async () => json(200, {}));
    await demoFetch("/customers");
    expect(new Headers(fetchFn.mock.calls[0]![1].headers).get("content-type")).toBeNull();
    await demoFetch("/customers", { method: "POST", body: "{}" });
    expect(new Headers(fetchFn.mock.calls[1]![1].headers).get("content-type")).toBe(
      "application/json",
    );
  });

  it("returns the response as-is on an error status, for readJson to report", async () => {
    stubFetch(async () => json(401, { error: "Not signed in." }));
    const res = await demoFetch("/customers");
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Not signed in." });
  });

  it("turns a network failure into a readable error", async () => {
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(demoFetch("/customers")).rejects.toThrow("Couldn't reach the server.");
  });

  it("refuses anything that isn't a /path", async () => {
    stubFetch(async () => json(200, {}));
    await expect(demoFetch("https://example.com/customers")).rejects.toThrow(/takes a \/path/);
  });
});
