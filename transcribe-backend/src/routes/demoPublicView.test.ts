import { describe, expect, it } from "bun:test";
import type { CallSound, Customer } from "../demo/types.js";

// The promo's `tests/public-view.test.ts`, moved to where the field list now lives.
//
// The demo page is public, so it must carry the business's own data and nothing the operator keeps
// about the business. That is a list, and a list rots: the danger is not someone deciding to publish
// a contact email, it is a field added to `Customer` later and reaching the page because nobody
// looked. So the key list is pinned here, and adding a field to `publicView` is meant to fail this
// test until someone writes it down.
//
// Run: bun test src/routes/demoPublicView.test.ts
//
// `demoPublic.ts` reaches `config/env.ts` through its imports, so these are set before it is loaded
// and the module is pulled in dynamically — a static import would hoist above them. Same pattern as
// `demo.pg.test.ts`. Nothing here touches the database.
process.env.DATABASE_URL ??= "postgres://unused/unused";
process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret-0123";

const { publicView } = await import("./demoPublic.js");
const { demoAllowance } = await import("../demo/analytics.js");
const { DEFAULT_DEMO_MINUTES } = await import("../demo/types.js");

// Written out rather than imported: there is no DEFAULT_CALL_SOUND on this side, and that is the
// point of sending `callSound` raw — the defaults live with the code that renders them.
const CALL_SOUND: CallSound = { phoneLine: true, ambience: "quiet" };

const customer: Customer = {
  id: "abc123456789",
  label: "warm lead",
  contactName: "Office manager",
  contactEmail: "private@example.com",
  notes: "internal note: pricing sensitive",
  active: true,
  businessName: "Factoria Family Dentistry",
  websiteUrl: "https://example.com",
  mapsUrl: "https://maps.app.goo.gl/x",
  resolvedMapsUrl: "https://maps.google.com/?cid=1",
  researchNotes: "the Bellevue branch only",
  profile: {
    name: "Factoria Family Dentistry",
    category: "Dentist",
    address: "4100 Factoria Blvd SE, Bellevue, WA",
    phone: "+1 425 555 0100",
    hours: [],
    services: [],
    highlights: [],
    policies: {},
    faqs: [],
  },
  dossier: "# Briefing",
  sources: [{ url: "https://example.com", title: "example.com" }],
  prompts: { live: "live", backend: "backend", greeting: "greeting", edited: true },
  voice: "gleam",
  callSound: CALL_SOUND,
  agentName: "Alex",
  language: "ko",
  demoMinutes: 20,
  stage: "interested",
  lastContactedAt: "2026-09-20T00:00:00.000Z",
  followUpAt: "2026-09-27T00:00:00.000Z",
  status: "ready",
  createdAt: "2026-09-19T00:00:00.000Z",
  updatedAt: "2026-09-19T00:00:00.000Z",
  researchedAt: "2026-09-19T01:00:00.000Z",
};

const view = publicView(customer, demoAllowance([], customer.demoMinutes ?? DEFAULT_DEMO_MINUTES));
const serialized = JSON.stringify(view);

describe("the public demo view", () => {
  it("carries what the business should see", () => {
    expect(view.name).toBe("Factoria Family Dentistry");
    expect(view.category).toBe("Dentist");
    expect(view.address).toBe("4100 Factoria Blvd SE, Bellevue, WA");
    expect(view.phone).toBe("+1 425 555 0100");
    expect(view.agentName).toBe("Alex");
    // The opening language is the business's own setting, not an operator note.
    expect(view.language).toBe("ko");
    // Sent raw for the page to resolve — see the note in `publicView`.
    expect(view.voice).toBe("gleam");
    expect(view.callSound).toEqual(CALL_SOUND);
    // The business is meant to be able to read what its receptionist has been told.
    expect(view.prompts.live).toBe("live");
    expect(view.prompts.backend).toBe("backend");
    expect(view.prompts.greeting).toBe("greeting");
    expect(view.dossier).toBe("# Briefing");
    expect(view.sources).toHaveLength(1);
    expect(view.researchedAt).toBe("2026-09-19T01:00:00.000Z");
    // How much demo time is left, so the page knows whether to show a call button at all.
    expect(view.demo.allowedSec).toBe(20 * 60);
    expect(view.demo.exhausted).toBe(false);
  });

  it("leaves out the operator's own notes about the business", () => {
    for (const secret of [
      customer.contactEmail!,
      customer.contactName!,
      customer.notes!,
      customer.label!,
      customer.researchNotes!,
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("leaves out the pipeline, which is the operator's view of this prospect", () => {
    for (const secret of [customer.stage!, customer.followUpAt!, customer.lastContactedAt!]) {
      expect(serialized).not.toContain(secret);
    }
    // The allowance is sent as seconds remaining; the configured budget is not a business's concern
    // beyond that, and `demoMinutes` itself is an operator field.
    expect(view).not.toHaveProperty("demoMinutes");
  });

  it("carries no field the page did not ask for", () => {
    expect(Object.keys(view).sort()).toEqual(
      [
        "address",
        "agentName",
        "callSound",
        "category",
        "customerId",
        "demo",
        "dossier",
        "language",
        "name",
        "phone",
        "profile",
        "prompts",
        "researchedAt",
        "sources",
        "voice",
      ].sort(),
    );
  });

  it("does not expose the prompts' edited flag, which is an operator detail", () => {
    expect(view.prompts).not.toHaveProperty("edited");
  });

  it("sends the id back under the name the page's props use", () => {
    // `customerId`, not `id`: the page passes it straight to `useLiveCall`, which dials with it.
    expect(view.customerId).toBe("abc123456789");
    expect(view).not.toHaveProperty("id");
  });
});
