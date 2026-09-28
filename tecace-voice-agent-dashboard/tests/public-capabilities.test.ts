import { describe, expect, it } from "vitest";
import {
  askFor,
  compactHours,
  doneKinds,
  emptyCapabilities,
  settingsFromCapabilities,
  summaryLines,
  tryCards,
  type PublicCapabilities,
} from "../src/public/capabilities";

// The demo page's reading of the operator's call settings (src/public/capabilities.ts).

const caps: PublicCapabilities = {
  transfers: [
    {
      id: "desk",
      name: "Front desk",
      mode: "warm",
      description: "Order pickups",
      collectBefore: "",
      rings: 1,
      hours: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map((day) => ({ day: day as never, open: "09:00", close: "17:00" })),
    },
    { id: "late", name: "On call", mode: "waterfall", description: "", collectBefore: "", rings: 3, hours: [] },
  ],
  links: [{ id: "map", triggers: ["directions"], text: "", url: "https://maps.example.com" }],
  messages: [{ id: "mgr", name: "Manager callback", brief: "Name, number and what it's about." }],
  appointments: { title: "Catering pickup", durationMinutes: 15, hours: [] },
  sms: { doubleOptIn: true },
  timezone: "America/Los_Angeles",
};

describe("settings for the simulator", () => {
  it("stands labels in for staff numbers, keeping how many phones a waterfall rings", () => {
    const s = settingsFromCapabilities(caps);
    expect(s.transfer.scenarios[0]!.numbers).toEqual(["Front desk's phone"]);
    expect(s.transfer.scenarios[1]!.numbers).toEqual(["On call's phone 1", "On call's phone 2", "On call's phone 3"]);
    expect(s.transfer.scenarios.every((t) => t.enabled)).toBe(true);
    expect(s.transfer.scenarios[0]!.collectBefore).toBe("The caller's name and the reason for the call");
    expect(s.links.scenarios[0]!.text).toContain("[business_name]");
    expect(s.appointments).toEqual(expect.objectContaining({ enabled: true, title: "Catering pickup", durationMinutes: 15 }));
    expect(s.timezone).toBe("America/Los_Angeles");
  });

  it("shows the booking rules as the operator set them, and defaults where an older backend sent none", () => {
    const full = settingsFromCapabilities({
      ...caps,
      appointments: { title: "Consult", durationMinutes: 45, hours: [], bufferMinutes: 10, minNoticeMinutes: 1440, horizonDays: 14, instructions: "Ask for the pet's name." },
    });
    expect(full.appointments).toEqual(
      expect.objectContaining({ bufferMinutes: 10, minNoticeMinutes: 1440, horizonDays: 14, instructions: "Ask for the pet's name." }),
    );
    const older = settingsFromCapabilities(caps);
    expect(older.appointments.minNoticeMinutes).toBe(120);
    expect(older.appointments.instructions).toBe("");
  });

  it("has nothing to play out when nothing was set up", () => {
    const s = settingsFromCapabilities(emptyCapabilities());
    expect(s.transfer.scenarios).toEqual([]);
    expect(s.appointments.enabled).toBe(false);
  });
});

describe("try saying", () => {
  it("asks for a team, a role or a person the way a caller would", () => {
    expect(askFor("Front desk")).toBe("Can I talk to someone at the front desk?");
    expect(askFor("Manager")).toBe("Can I speak to the manager?");
    expect(askFor("Sam")).toBe("Can I speak to Sam?");
  });

  it("makes one card per feature set up, then tops up with the business's questions", () => {
    const cards = tryCards(caps, ["Do you have parking?"]);
    expect(cards.map((c) => c.kind)).toEqual(["transfer", "link", "booking", "message"]);
    // The any-hours transfer is the one to try; a team with hours may be closed right now.
    expect(cards[0]).toEqual(expect.objectContaining({ tag: "Transfer · Waterfall", say: "Can I speak to On call?", detail: "Rings On call" }));
    const onlyDesk = tryCards({ ...caps, transfers: [caps.transfers[0]!] }, []);
    expect(onlyDesk[0]).toEqual(expect.objectContaining({ tag: "Transfer · Warm", detail: "Rings Front desk · Mon–Fri 09:00–17:00" }));
    expect(cards[1]!.say).toBe("Can you text me the directions?");
    expect(cards[2]!.say).toBe("Can I book a catering pickup for Saturday?");
    const bare = tryCards(emptyCapabilities(), ["Do you have parking?", "Are you open now?"]);
    expect(bare.map((c) => c.kind)).toEqual(["question", "question"]);
  });
});

describe("what the call did", () => {
  const at = "2026-09-27T12:00:00Z";
  const events = [
    { at, type: "transfer_requested", data: {} },
    { at, type: "transfer_final", data: { success: true } },
    { at, type: "consent_requested", data: {} },
    { at, type: "link_sent", data: {} },
    { at, type: "booking_made", data: { when: "Saturday at 11:30 AM" } },
  ];

  it("ticks the cards for what happened", () => {
    expect([...doneKinds(events)].sort()).toEqual(["booking", "link", "transfer"]);
  });

  it("sums it up in order, one line each", () => {
    expect(summaryLines(events, true)).toEqual([
      "Answered your questions from what it knows about the business",
      "Put you through, and the phone was answered",
      "Asked your OK before texting a link",
      "Texted you the link",
      "Booked Saturday at 11:30 AM on the demo calendar",
    ]);
    expect(summaryLines([], false)).toEqual([]);
  });
});

describe("hours as a person says them", () => {
  const day = (d: string, open = "08:00", close = "21:30", closed = false) => ({ day: d, open, close, closed });
  it("joins runs of days", () => {
    expect(compactHours(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((d) => day(d)))).toBe("Every day 08:00–21:30");
    expect(
      compactHours([
        ...["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map((d) => day(d, "09:00", "18:00")),
        day("Saturday", "10:00", "14:00"),
        day("Sunday", "", "", true),
      ]),
    ).toBe("Mon–Fri 09:00–18:00 · Sat 10:00–14:00");
    expect(compactHours([])).toBe("Any time");
  });
});
