import { describe, expect, it } from "bun:test";

// analytics.ts is a verbatim copy of the promo's lib/analytics.ts — that is what lets the Overview
// and CRM numbers match the promo by construction rather than by re-derivation. This test fails if
// either side is edited, so the copy cannot quietly drift into a reimplementation.
const PROMO = String.raw`C:\Users\Michael Knutsen\Documents\projects\test_demo\voiceagent_promo\lib\analytics.ts`;

describe("analytics.ts stays a verbatim copy", () => {
  it("differs from the promo's only by the documented lines", async () => {
    const promoFile = Bun.file(PROMO);
    if (!(await promoFile.exists())) return; // the promo repo is not on every machine
    const theirs = (await promoFile.text()).replace(/\r\n/g, "\n").split("\n");
    const ours = (await Bun.file("src/demo/analytics.ts").text()).replace(/\r\n/g, "\n").split("\n");
    expect(ours.length).toBe(theirs.length);
    const differing = ours
      .map((line, i) => (line === theirs[i] ? null : i + 1))
      .filter((n): n is number => n !== null);
    // Every difference must be listed in PORTING.md, by line number.
    const porting = await Bun.file("src/demo/PORTING.md").text();
    for (const line of differing) expect(porting).toContain(`analytics.ts:${line}`);
  });
});
