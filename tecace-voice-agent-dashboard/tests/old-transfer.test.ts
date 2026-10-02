import { describe, expect, it } from "vitest";
import { emptyCallSettings, oldTransferInUse, oldTransferScenario } from "../src/settings/callSettings";

// The Transfers page must show the number set up before transfer scenarios whenever real calls
// still dial it — the rule transcribe-backend's composeSession and the agent's older prompt follow.

const structured = { transferNumber: "+12065550123", profile: { name: "TecAce Test" } };
const withTransfer = () => {
  const settings = emptyCallSettings();
  settings.transfer.scenarios = [oldTransferScenario("+12065550199")];
  return settings;
};

describe("oldTransferInUse", () => {
  it("is the old number while nothing has been published", () => {
    expect(oldTransferInUse(structured, { published: null })).toBe("+12065550123");
  });

  it("does not depend on the draft: a saved but unpublished transfer does not replace it", () => {
    // The stored settings carry the draft too; only `published` is read.
    const stored = { published: null, draft: withTransfer() };
    expect(oldTransferInUse(structured, stored)).toBe("+12065550123");
  });

  it("is gone once call settings are published, with or without transfers", () => {
    expect(oldTransferInUse(structured, { published: emptyCallSettings() })).toBeNull();
    expect(oldTransferInUse(structured, { published: withTransfer() })).toBeNull();
  });

  it("stays for a profile from before the structured editor, whatever is published", () => {
    const older = { transferNumber: "+12065550123", profile: null };
    expect(oldTransferInUse(older, { published: withTransfer() })).toBe("+12065550123");
  });

  it("is null when there is no old number", () => {
    expect(oldTransferInUse({ transferNumber: null, profile: {} }, { published: null })).toBeNull();
  });
});

describe("oldTransferScenario", () => {
  it("is a cold, always-on transfer to that one number, with the business's topics", () => {
    const scenario = oldTransferScenario("+12065550123", "Gift cards.");
    expect(scenario).toMatchObject({ mode: "cold", enabled: true, numbers: ["+12065550123"], hours: [] });
    expect(scenario.description).toContain("Also: Gift cards.");
  });
});
