import { describe, expect, it } from "bun:test";
import { inferNumberType, signedUrlFor, webhookStateOf, webhookUrlsFor } from "./webhooks.js";

// What a number's webhooks should be, whether Twilio's copy still matches, and the URL a signature is
// checked against. All pure. Run: bun test src/twilio/webhooks.test.ts

const CFG = { agentPublicUrl: "https://agent.example.com/", publicBackendUrl: "https://api.example.com" };

describe("webhookUrlsFor", () => {
  it("points voice at the agent and status at this backend, trailing slashes dropped", () => {
    expect(webhookUrlsFor(CFG)).toEqual({
      voiceUrl: "https://agent.example.com/incoming",
      voiceFallbackUrl: "https://agent.example.com/incoming-fallback",
      statusCallback: "https://api.example.com/twilio/voice-status",
    });
  });

  it("is null until both origins are set — half a configuration is not one", () => {
    expect(webhookUrlsFor({ ...CFG, agentPublicUrl: "" })).toBeNull();
    expect(webhookUrlsFor({ ...CFG, publicBackendUrl: "" })).toBeNull();
  });
});

describe("webhookStateOf", () => {
  const wanted = webhookUrlsFor(CFG)!;

  it("is ok when Twilio has exactly what we want", () => {
    expect(
      webhookStateOf(
        {
          voiceUrl: wanted.voiceUrl,
          voiceFallbackUrl: wanted.voiceFallbackUrl,
          statusCallback: wanted.statusCallback,
        },
        wanted,
      ),
    ).toBe("ok");
  });

  it("is stale when the voice URL points elsewhere", () => {
    expect(
      webhookStateOf(
        { voiceUrl: "https://old-host.example.com/incoming", voiceFallbackUrl: wanted.voiceFallbackUrl, statusCallback: wanted.statusCallback },
        wanted,
      ),
    ).toBe("stale");
  });

  it("is stale when the status callback was never set — a hand-configured number", () => {
    expect(
      webhookStateOf({ voiceUrl: wanted.voiceUrl, voiceFallbackUrl: wanted.voiceFallbackUrl, statusCallback: null }, wanted),
    ).toBe("stale");
  });

  it("ignores the SMS URL unless one is wanted", () => {
    const actual = { voiceUrl: wanted.voiceUrl, voiceFallbackUrl: wanted.voiceFallbackUrl, statusCallback: wanted.statusCallback, smsUrl: "https://elsewhere/sms" };
    expect(webhookStateOf(actual, wanted)).toBe("ok");
    expect(webhookStateOf(actual, { ...wanted, smsUrl: "https://api.example.com/twilio/sms" })).toBe("stale");
  });
});

describe("inferNumberType", () => {
  it("knows the US toll-free area codes", () => {
    for (const npa of ["800", "833", "844", "855", "866", "877", "888"]) {
      expect(inferNumberType(`+1${npa}5550123`)).toBe("tollfree");
    }
  });

  it("calls every other US number local", () => {
    expect(inferNumberType("+12065550123")).toBe("local");
    expect(inferNumberType("+18015550123")).toBe("local"); // 801 is Utah, not toll-free
  });

  it("does not guess outside +1", () => {
    expect(inferNumberType("+447700900123")).toBeNull();
    expect(inferNumberType("")).toBeNull();
  });
});

describe("signedUrlFor", () => {
  it("rebuilds the URL Twilio called from the configured origin, query string included", () => {
    const request = new Request("http://localhost:8001/twilio/voice-status?leg=1");
    expect(signedUrlFor("https://api.example.com", request)).toBe("https://api.example.com/twilio/voice-status?leg=1");
  });

  it("never trusts the request's own host", () => {
    const request = new Request("https://evil.example.net/twilio/voice-status");
    expect(signedUrlFor("https://api.example.com/", request)).toBe("https://api.example.com/twilio/voice-status");
  });
});
