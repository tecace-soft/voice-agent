import { describe, expect, it } from "vitest";
import { SECTION_IDS, formatHash, nextRoute, parseHash, type Route } from "../src/routing";

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

  it("lands on Dashboard › Overview, and falls back to it for anything unknown", () => {
    expect(parseHash("").view).toBe("dashboard");
    expect(parseHash("#/nope").view).toBe("dashboard");
    expect(parseHash("#/demos/prospects/x/extra").view).toBe("dashboard");
  });

  it("keeps the mailbox scope, as before", () => {
    expect(parseHash("#/overview?mailbox=sam%40tecace.com").mailbox).toBe("sam@tecace.com");
    expect(parseHash("#/runs?mailbox=unattributed").mailbox).toBeNull();
    expect(parseHash("#/runs").mailbox).toBeUndefined();
  });
});

describe("settings sections", () => {
  it("reads an optional section on the Business page and a prospect", () => {
    expect(parseHash("#/business")).toEqual({ view: "business", mailbox: undefined });
    expect(parseHash("#/business/transfers")).toEqual({
      view: "business",
      mailbox: undefined,
      section: "transfers",
    });
    expect(parseHash("#/demos/prospects/AbC/faqs")).toEqual({
      view: "demoProspect",
      mailbox: undefined,
      id: "AbC",
      section: "faqs",
    });
  });

  it("refuses a section that does not exist", () => {
    expect(parseHash("#/business/nope").view).toBe("dashboard");
  });

  it("writes and round-trips a section", () => {
    const route: Route = { view: "business", mailbox: "jane@tecace.com", section: "text-link" };
    expect(formatHash(route)).toBe("#/business/text-link?mailbox=jane%40tecace.com");
    expect(parseHash(formatHash(route))).toEqual(route);
    expect(formatHash({ view: "business", mailbox: undefined })).toBe("#/business");
  });

  it("opens the guided setup section", () => {
    expect(SECTION_IDS).toContain("guided-setup");
    expect(SECTION_IDS).toContain("scenario-tests");
    const route = parseHash("#/business/guided-setup");
    expect(route).toEqual({ view: "business", mailbox: undefined, section: "guided-setup" });
    expect(formatHash(route)).toBe("#/business/guided-setup");
  });
});

describe("prospect tabs", () => {
  it("reads a tab on a prospect", () => {
    expect(parseHash("#/demos/prospects/AbC/email")).toEqual({
      view: "demoProspect",
      mailbox: undefined,
      id: "AbC",
      tab: "email",
    });
    expect(parseHash("#/demos/prospects/AbC/Research").tab).toBe("research");
  });

  it("opens an old tab name (Activity, Settings, Sources, Share) on its new tab", () => {
    expect(parseHash("#/demos/prospects/AbC/activity").tab).toBe("overview");
    expect(parseHash("#/demos/prospects/AbC/settings").tab).toBe("receptionist");
    expect(parseHash("#/demos/prospects/AbC/sources").tab).toBe("research");
    expect(parseHash("#/demos/prospects/AbC/share").tab).toBe("email");
  });

  it("refuses a tab name anywhere but a prospect", () => {
    expect(parseHash("#/business/share").view).toBe("dashboard");
  });

  it("writes a section over a tab (a section is on Settings)", () => {
    expect(
      formatHash({ view: "demoProspect", mailbox: undefined, id: "AbC", tab: "receptionist", section: "faqs" }),
    ).toBe("#/demos/prospects/AbC/faqs");
    expect(formatHash({ view: "demoProspect", mailbox: undefined, id: "AbC", tab: "overview" })).toBe(
      "#/demos/prospects/AbC/overview",
    );
  });

  it("round-trips a tab with a mailbox scope", () => {
    const route: Route = { view: "demoProspect", mailbox: "sam@tecace.com", id: "AbC", tab: "research" };
    expect(parseHash(formatHash(route))).toEqual(route);
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
      "demoPipeline", "myOverview", "myCalls", "changelog", "billing",
    ].map((view) => ({ view, mailbox: undefined }) as Route);
    routes.push({ view: "demoProspect", mailbox: undefined, id: "pr0SPct1" });
    for (const route of routes) expect(parseHash(formatHash(route))).toEqual(route);
  });
});

// Which business an admin is looking at (Business information, Answered calls) is its own field,
// not the voicemail mailbox scope: it used to be `?mailbox=`, which followed the admin to every
// other view and locked them into that business.
describe("customer (the business an admin is viewing)", () => {
  it("reads and writes ?customer= beside the mailbox", () => {
    expect(parseHash("#/business?customer=sam%40tecace.com")).toEqual({
      view: "business",
      mailbox: undefined,
      customer: "sam@tecace.com",
    });
    const route: Route = { view: "calls", mailbox: "kim@x.example", customer: "sam@tecace.com" };
    expect(formatHash(route)).toBe("#/calls?mailbox=kim%40x.example&customer=sam%40tecace.com");
    expect(parseHash(formatHash(route))).toEqual(route);
  });

  it("round-trips a customer with a section", () => {
    const route: Route = { view: "business", mailbox: undefined, customer: "sam@tecace.com", section: "transfers" };
    expect(parseHash(formatHash(route))).toEqual(route);
  });
});

describe("nextRoute", () => {
  const onSam: Route = { view: "business", mailbox: undefined, customer: "sam@tecace.com", section: "transfers" };

  it("drops the customer when moving to another view", () => {
    expect(nextRoute(onSam, { view: "overview" })).toEqual({ view: "overview", mailbox: undefined });
    expect(nextRoute(onSam, { view: "calls" })).toEqual({ view: "calls", mailbox: undefined });
  });

  it("keeps the voicemail mailbox scope across views, as before", () => {
    expect(nextRoute({ view: "overview", mailbox: "sam@tecace.com" }, { view: "runs" })).toEqual({
      view: "runs",
      mailbox: "sam@tecace.com",
    });
  });

  it("keeps a customer the next route names", () => {
    expect(nextRoute({ view: "demoProspect", mailbox: undefined, id: "x" }, { view: "business", customer: "a@b.c" })).toEqual({
      view: "business",
      mailbox: undefined,
      customer: "a@b.c",
    });
  });

  it("closes the section when the customer changes", () => {
    expect(nextRoute(onSam, { customer: "kim@x.example" })).toEqual({
      view: "business",
      mailbox: undefined,
      customer: "kim@x.example",
    });
    expect(nextRoute(onSam, { customer: undefined })).toEqual({ view: "business", mailbox: undefined });
  });

  it("keeps the section when only the section changes", () => {
    expect(nextRoute(onSam, { section: "faqs" })).toEqual({ ...onSam, section: "faqs" });
  });
});
