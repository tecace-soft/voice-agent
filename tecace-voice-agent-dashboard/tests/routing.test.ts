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
