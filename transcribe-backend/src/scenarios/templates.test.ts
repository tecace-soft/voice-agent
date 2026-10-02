import { describe, expect, it } from "bun:test";

// The built-in scenarios: which apply to a business, which appointment times they use, and how
// "{slotA.spoken}" becomes "tomorrow at 3 PM" (or "내일 오후 3시") when a pass starts.
//
// Run: bun test src/scenarios/templates.test.ts
process.env.DATABASE_URL ??= "postgres://unused/unused";
process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret-0123";

const { validateCallSettings } = await import("../business/callSettings.js");
const { TEMPLATES, placeholderValues, resolveDefinition, scenarioSlots, templateById } = await import("./templates.js");
import type { BusinessProfile } from "../demo/types.js";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const profile: BusinessProfile = {
  name: "Jane's Salon",
  category: "Hair salon",
  address: "1 A St, Tacoma, WA",
  hours: DAYS.map((day) => ({ day, open: "09:00", close: "17:00" })),
  services: [{ name: "Haircut" }],
  highlights: [],
  policies: {},
  faqs: [],
};
const settings = validateCallSettings(
  {
    appointments: { enabled: true },
    transfer: { scenarios: [{ id: "front", mode: "cold", name: "Front desk", numbers: ["2065550134"] }] },
  },
  { waterfallAllowed: false },
);
const noBooking = validateCallSettings({}, { waterfallAllowed: false });
const TZ = "America/Los_Angeles";
// Thursday 1 October 2026, 10:00 in Los Angeles.
const NOW = Date.parse("2026-10-01T17:00:00Z");

describe("templates", () => {
  it("all twelve apply to a business with hours, an address, an unpriced service, booking and a transfer", () => {
    const ctx = { profile, settings, language: "en" as const };
    expect(TEMPLATES.filter((t) => t.applies(ctx)).map((t) => t.id)).toEqual([
      "S01", "S02", "S03", "S04", "S05", "S06", "S07", "S08", "S09", "S10", "S11", "S12",
    ]);
  });

  it("without booking, the booking ones drop out and S12 fails take_message instead", () => {
    const ctx = { profile, settings: noBooking, language: "en" as const };
    expect(TEMPLATES.filter((t) => t.applies(ctx)).map((t) => t.id)).toEqual(["S01", "S02", "S03", "S10", "S11", "S12"]);
    expect(templateById("S12")!.build(ctx).world.failTool).toBe("take_message");
  });

  it("picks tomorrow at 3 PM and the next opening an hour later", () => {
    const slots = scenarioSlots({ settings, profile, timeZone: TZ, now: NOW })!;
    expect(new Date(slots.slotA).toISOString()).toBe("2026-10-02T22:00:00.000Z");
    expect(new Date(slots.slotB!).toISOString()).toBe("2026-10-02T23:00:00.000Z");
    expect(scenarioSlots({ settings: noBooking, profile, timeZone: TZ, now: NOW })).toBeNull();
  });

  it("says the times the way a caller would, in English and Korean", () => {
    const slots = scenarioSlots({ settings, profile, timeZone: TZ, now: NOW });
    const en = placeholderValues(slots, NOW, TZ, "en");
    expect(en["slotA.spoken"]).toBe("tomorrow at 3 PM");
    expect(en["slotB.clock"]).toBe("4 PM");
    const ko = placeholderValues(slots, NOW, TZ, "ko");
    expect(ko["slotA.spoken"]).toBe("내일 오후 3시");
    expect(Date.parse(en.slotA!)).toBe(slots!.slotA);
  });

  it("resolves S06 into the corrected time", () => {
    const ctx = { profile, settings, language: "en" as const };
    const slots = scenarioSlots({ settings, profile, timeZone: TZ, now: NOW });
    const out = resolveDefinition(templateById("S06")!.build(ctx), placeholderValues(slots, NOW, TZ, "en"));
    if (!out.ok) throw new Error(out.error);
    expect(out.definition.customerLines[0]).toContain("I'd like to book tomorrow at 3 PM. Oh wait, not 3 PM, make it 4 PM.");
    expect(Date.parse(out.definition.expect.tools![0]!.args!.start!)).toBe(slots!.slotB!);
  });

  it("says why when a scenario needs a time and there is none", () => {
    const ctx = { profile, settings, language: "en" as const };
    const out = resolveDefinition(templateById("S05")!.build(ctx), placeholderValues(null, NOW, TZ, "en"));
    expect(out.ok).toBe(false);
  });

  it("keeps slotB on slotA's day even when the last start is 3 PM", () => {
    const short = { ...profile, hours: DAYS.map((day) => ({ day, open: "09:00", close: "16:00" })) };
    const s60 = validateCallSettings({ appointments: { enabled: true, durationMinutes: 60 } }, { waterfallAllowed: false });
    const slots = scenarioSlots({ settings: s60, profile: short, timeZone: TZ, now: NOW })!;
    expect(slots.slotB).not.toBeNull();
    const day = (at: number) => new Date(at - 7 * 3_600_000).toISOString().slice(0, 10);
    expect(day(slots.slotB!)).toBe(day(slots.slotA));
    expect(slots.slotB! - slots.slotA).toBeGreaterThanOrEqual(3_600_000);
  });

  it("gives slotB null when no day has a pair, and S06 then fails to resolve", () => {
    const tiny = { ...profile, hours: DAYS.map((day) => ({ day, open: "09:00", close: "09:30" })) };
    const slots = scenarioSlots({ settings, profile: tiny, timeZone: TZ, now: NOW })!;
    expect(slots.slotB).toBeNull();
    const values = placeholderValues(slots, NOW, TZ, "en");
    expect(values.slotA).toBeDefined();
    expect(values.slotB).toBeUndefined();
    const ctx = { profile: tiny, settings, language: "en" as const };
    const out = resolveDefinition(templateById("S06")!.build(ctx), values);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain("two open appointment times on the same day");
  });

  it("names a later day without 'on' in English and Korean", () => {
    const closedFriday = {
      ...profile,
      hours: DAYS.map((day) => (day === "Friday" ? { day, closed: true } : { day, open: "09:00", close: "17:00" })),
    } as BusinessProfile;
    const slots = scenarioSlots({ settings, profile: closedFriday, timeZone: TZ, now: NOW });
    const en = placeholderValues(slots, NOW, TZ, "en");
    expect(en["slotA.day"]).toBe("Saturday, October 3");
    expect(en["slotA.spoken"]).toBe("Saturday, October 3 at 3 PM");
    const ko = placeholderValues(slots, NOW, TZ, "ko");
    expect(ko["slotA.day"]).toBe("10월 3일 토요일");
    expect(ko["slotA.spoken"]).toBe("10월 3일 토요일 오후 3시");
  });

  it("S12, S08, Korean lines and S03 are shaped as reviewed", () => {
    const en = { profile, settings, language: "en" as const };
    const ko = { profile, settings, language: "ko" as const };
    expect(templateById("S12")!.build(en).expect.tools).toEqual([{ name: "book_appointment" }]);
    expect(templateById("S12")!.build({ ...en, settings: noBooking }).expect.tools).toEqual([{ name: "take_message" }]);
    const s08 = templateById("S08")!.build(en);
    expect(s08.customerLines[1]).toBe("No thanks, I'll call back another time.");
    expect(s08.expect.judge![0]).toContain("Only says {slotA.spoken} is unavailable after a tool");
    expect(templateById("S05")!.build(ko).customerLines[0]).toContain("5678이에요");
    expect(templateById("S06")!.build(ko).customerLines[0]).toContain("{slotB.clock}에 해주세요");
    expect(templateById("S11")!.build(ko).customerLines[0]).toContain("아, 아니에요,");
    const blank = { ...profile, services: [{ name: "  " }, { name: "Color" }] };
    expect(templateById("S03")!.build({ ...en, profile: blank }).customerLines[0]).toBe("How much does Color cost?");
    expect(templateById("S03")!.applies({ ...en, profile: { ...profile, services: [{ name: " " }] } })).toBe(false);
  });

  it("rejects a placeholder it does not know", () => {
    const def = { ...templateById("S01")!.build({ profile, settings, language: "en" }), customerLines: ["Is {slotA.time} free?"] };
    const out = resolveDefinition(def, {});
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain("Unknown placeholder {slotA.time}");
  });
});
