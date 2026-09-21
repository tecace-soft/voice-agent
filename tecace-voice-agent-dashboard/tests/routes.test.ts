import { afterEach, describe, expect, it, vi } from "vitest";
import { demoHref } from "../src/demos/routes";

function atHash(hash: string) {
  vi.stubGlobal("window", { location: { hash } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("demoHref", () => {
  it("links a Demos view and a record", () => {
    atHash("#/demos/overview");
    expect(demoHref("demoOverview")).toBe("#/demos/overview");
    expect(demoHref("demoProspect", "pr0SPct1")).toBe("#/demos/prospects/pr0SPct1");
  });

  it("keeps the current mailbox scope, as the sidebar does", () => {
    atHash("#/demos/prospects?mailbox=sam%40tecace.com");
    expect(demoHref("demoProspect", "pr0SPct1")).toBe(
      "#/demos/prospects/pr0SPct1?mailbox=sam%40tecace.com",
    );
    atHash("#/overview?mailbox=unattributed");
    expect(demoHref("demoProspects")).toBe("#/demos/prospects?mailbox=unattributed");
  });

  it("uses an explicit scope over the current one", () => {
    atHash("#/demos/prospects?mailbox=sam%40tecace.com");
    expect(demoHref("demoProspects", undefined, { mailbox: undefined })).toBe("#/demos/prospects");
    expect(demoHref("demoProspects", undefined, { mailbox: "kim@tecace.com" })).toBe(
      "#/demos/prospects?mailbox=kim%40tecace.com",
    );
  });
});
