import { describe, expect, it } from "bun:test";
import { emptyCallSettings } from "./callSettings.js";
import { evaluateReadiness, type ReadinessInput } from "./readiness.js";

// The checklist Go live is gated on, item by item. Run: bun test src/business/readiness.test.ts

const READY: ReadinessInput = {
  profile: { isLive: true, transferNumber: "+12065550123", profile: null },
  agentNumber: "+12065550100",
  settings: { published: emptyCallSettings(), waterfallAllowed: false },
  // A number bought or synced through Twilio, with its webhooks as this server wants them.
  number: { managed: true, webhookState: "ok" },
  twilioConfigured: true,
};

const failing = (input: ReadinessInput) =>
  evaluateReadiness(input)
    .items.filter((item) => !item.ok)
    .map((item) => item.id);

describe("evaluateReadiness", () => {
  it("is ready when every item is ticked", () => {
    const result = evaluateReadiness(READY);
    expect(result.ready).toBe(true);
    expect(failing(READY)).toEqual([]);
  });

  it("needs business information", () => {
    const input = { ...READY, profile: { ...READY.profile, isLive: false } };
    expect(evaluateReadiness(input).ready).toBe(false);
    expect(failing(input)).toEqual(["business_info"]);
  });

  it("needs published settings, and cannot check them against the number without them", () => {
    const input = { ...READY, settings: { ...READY.settings, published: null } };
    expect(evaluateReadiness(input).ready).toBe(false);
    expect(failing(input)).toEqual(["settings_published", "published_matches_number"]);
  });

  it("needs a number", () => {
    const input = { ...READY, agentNumber: null };
    expect(failing(input)).toEqual(["number_assigned", "published_matches_number"]);
  });

  it("flags published settings that no longer fit the number, e.g. a transfer that rings itself", () => {
    const settings = emptyCallSettings();
    settings.transfer.scenarios = [
      {
        id: "s1",
        enabled: true,
        mode: "cold",
        name: "Front desk",
        description: "Any call",
        // Published before this number was assigned: now it is the assistant's own line.
        numbers: ["+12065550100"],
        collectBefore: "",
        holdMusic: "classical",
        hours: [],
      },
    ];
    const input = { ...READY, settings: { published: settings, waterfallAllowed: false } };
    const result = evaluateReadiness(input);
    expect(result.ready).toBe(false);
    const item = result.items.find((entry) => entry.id === "published_matches_number")!;
    expect(item.ok).toBe(false);
    expect(item.detail).toBeTruthy();
  });

  it("only warns when there is no number to reach the business", () => {
    const input = { ...READY, profile: { isLive: true, transferNumber: null, profile: null } };
    const result = evaluateReadiness(input);
    expect(result.ready).toBe(true);
    expect(failing(input)).toEqual(["contact_number"]);
  });

  it("counts a phone on the business information or a transfer number as a way to reach them", () => {
    const withPhone = {
      ...READY,
      profile: { isLive: true, transferNumber: null, profile: { phone: "+12065550199" } },
    };
    expect(failing(withPhone)).toEqual([]);
  });

  it("requires Twilio to send calls to the receptionist when the number is ours to configure", () => {
    const input: ReadinessInput = { ...READY, number: { managed: true, webhookState: "stale" } };
    const result = evaluateReadiness(input);
    expect(result.ready).toBe(false);
    expect(failing(input)).toEqual(["webhooks_configured"]);
    expect(result.items.find((item) => item.id === "webhooks_configured")!.required).toBe(true);
  });

  it("shows the webhook error Twilio gave when there is one", () => {
    const input: ReadinessInput = {
      ...READY,
      number: { managed: true, webhookState: "error", webhookError: "Twilio answered 401" },
    };
    const item = evaluateReadiness(input).items.find((entry) => entry.id === "webhooks_configured")!;
    expect(item.ok).toBe(false);
    expect(item.detail).toBe("Twilio answered 401");
  });

  it("only advises about the webhooks of a number registered by hand", () => {
    const input: ReadinessInput = { ...READY, number: null };
    const result = evaluateReadiness(input);
    expect(result.ready).toBe(true);
    expect(failing(input)).toEqual(["webhooks_configured"]);
    expect(result.items.find((item) => item.id === "webhooks_configured")!.required).toBe(false);
  });

  it("cannot require what this server cannot check: no Twilio credentials, no blocking", () => {
    const input: ReadinessInput = { ...READY, number: { managed: true, webhookState: "stale" }, twilioConfigured: false };
    const result = evaluateReadiness(input);
    expect(result.ready).toBe(true);
    expect(result.items.find((item) => item.id === "webhooks_configured")!.required).toBe(false);
  });

  it("says nothing about webhooks while there is no number to have them", () => {
    const input: ReadinessInput = { ...READY, agentNumber: null, number: null };
    expect(evaluateReadiness(input).items.map((item) => item.id)).not.toContain("webhooks_configured");
  });
});

// Who ticks each item: the customer's part is what they can do from their settings; the number and
// how Twilio reaches it are the admin's, done at Go live.
describe("owner and customerReady", () => {
  it("names who ticks each item", () => {
    const owners = Object.fromEntries(evaluateReadiness(READY).items.map((item) => [item.id, item.owner]));
    expect(owners).toEqual({
      business_info: "customer",
      settings_published: "customer",
      contact_number: "customer",
      number_assigned: "admin",
      published_matches_number: "admin",
      webhooks_configured: "admin",
    });
  });

  it("is customer-ready with their part done and no number yet", () => {
    const result = evaluateReadiness({ ...READY, agentNumber: null, number: null });
    expect(result.ready).toBe(false);
    expect(result.customerReady).toBe(true);
  });

  it("is not customer-ready until they publish, and advice does not block it", () => {
    const unpublished = { ...READY, agentNumber: null, number: null, settings: { ...READY.settings, published: null } };
    expect(evaluateReadiness(unpublished).customerReady).toBe(false);
    const noContact = {
      ...READY,
      agentNumber: null,
      number: null,
      profile: { isLive: true, transferNumber: null, profile: null },
    };
    expect(evaluateReadiness(noContact).customerReady).toBe(true);
  });
});
