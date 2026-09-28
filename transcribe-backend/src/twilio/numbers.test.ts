import { afterEach, describe, expect, it } from "bun:test";
import {
  agentIncomingUrl,
  agentStatus,
  connectNumber,
  listOwnedNumbers,
  TwilioError,
  twilioConfigFrom,
  type TwilioConfig,
} from "./numbers.js";

// The Twilio client on its own: no database, no app. `fetch` is stubbed per test and every request
// it sees is recorded, so the tests check what we send as well as how we read the answer.
//
// Run: bun test src/twilio/numbers.test.ts

const BASE = "https://twilio.fake.test";
const CFG: TwilioConfig = { accountSid: "AC123", username: "SK456", password: "secret", apiBase: BASE };
const AGENT = "https://agent.example.test";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

type Seen = { url: string; method: string; headers: Headers; body: string };
function stub(answer: (seen: Seen) => Response): Seen[] {
  const seen: Seen[] = [];
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const entry: Seen = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: init?.body ? String(init.body) : "",
    };
    seen.push(entry);
    return answer(entry);
  }) as typeof fetch;
  return seen;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const raw = (sid: string, phone: string, voiceUrl: string, fallback = "") => ({
  sid,
  phone_number: phone,
  friendly_name: phone,
  voice_url: voiceUrl,
  voice_fallback_url: fallback,
});

describe("twilioConfigFrom", () => {
  const empty = { twilioAccountSid: "", twilioApiKeySid: "", twilioApiKeySecret: "", twilioAuthToken: "", twilioApiBase: BASE };

  it("prefers the API key", () => {
    expect(
      twilioConfigFrom({ ...empty, twilioAccountSid: "AC1", twilioApiKeySid: "SK1", twilioApiKeySecret: "s", twilioAuthToken: "tok" }),
    ).toEqual({ accountSid: "AC1", username: "SK1", password: "s", apiBase: BASE });
  });

  it("falls back to the auth token, with the account SID as the username", () => {
    expect(twilioConfigFrom({ ...empty, twilioAccountSid: "AC1", twilioAuthToken: "tok" })).toEqual({
      accountSid: "AC1",
      username: "AC1",
      password: "tok",
      apiBase: BASE,
    });
  });

  it("is null without an account SID or without any credential", () => {
    expect(twilioConfigFrom({ ...empty, twilioAuthToken: "tok" })).toBeNull();
    expect(twilioConfigFrom({ ...empty, twilioAccountSid: "AC1" })).toBeNull();
    expect(twilioConfigFrom({ ...empty, twilioAccountSid: "AC1", twilioApiKeySid: "SK1" })).toBeNull();
  });
});

describe("agentStatus", () => {
  it("is connected when the voice URL is the agent's /incoming", () => {
    expect(agentStatus(`${AGENT}/incoming`, AGENT)).toBe("connected");
    expect(agentStatus(`${AGENT}/incoming/`, AGENT)).toBe("connected");
    expect(agentStatus("https://AGENT.example.test/incoming", AGENT)).toBe("connected");
    expect(agentStatus(`${AGENT}/incoming`, `${AGENT}/`)).toBe("connected");
  });

  it("is not_connected with no voice URL", () => {
    expect(agentStatus(null, AGENT)).toBe("not_connected");
    expect(agentStatus("", AGENT)).toBe("not_connected");
    expect(agentStatus(null, null)).toBe("not_connected");
  });

  it("is elsewhere for any other URL, or any URL when there is no agent base", () => {
    expect(agentStatus("https://demo.twilio.com/welcome/voice/", AGENT)).toBe("elsewhere");
    expect(agentStatus(`${AGENT}/incoming-fallback`, AGENT)).toBe("elsewhere");
    expect(agentStatus(`${AGENT}/INCOMING`, AGENT)).toBe("elsewhere");
    expect(agentStatus(`${AGENT}/incoming`, null)).toBe("elsewhere");
  });

  it("builds the incoming URL from a base with or without a trailing slash", () => {
    expect(agentIncomingUrl(AGENT)).toBe(`${AGENT}/incoming`);
    expect(agentIncomingUrl(`${AGENT}/`)).toBe(`${AGENT}/incoming`);
  });
});

describe("listOwnedNumbers", () => {
  it("reads every page and maps empty URLs to null", async () => {
    const seen = stub((req) =>
      req.url.includes("Page=1")
        ? json({ incoming_phone_numbers: [raw("PN2", "+14255987522", "")], next_page_uri: null })
        : json({
            incoming_phone_numbers: [raw("PN1", "+14255988987", `${AGENT}/incoming`, `${AGENT}/incoming-fallback`)],
            next_page_uri: "/2010-04-01/Accounts/AC123/IncomingPhoneNumbers.json?PageSize=1000&Page=1&PageToken=PA1",
          }),
    );

    const numbers = await listOwnedNumbers(CFG);

    expect(numbers).toEqual([
      {
        sid: "PN1",
        phoneE164: "+14255988987",
        friendlyName: "+14255988987",
        voiceUrl: `${AGENT}/incoming`,
        voiceFallbackUrl: `${AGENT}/incoming-fallback`,
      },
      { sid: "PN2", phoneE164: "+14255987522", friendlyName: "+14255987522", voiceUrl: null, voiceFallbackUrl: null },
    ]);
    expect(seen.map((s) => s.url)).toEqual([
      `${BASE}/2010-04-01/Accounts/AC123/IncomingPhoneNumbers.json?PageSize=1000`,
      `${BASE}/2010-04-01/Accounts/AC123/IncomingPhoneNumbers.json?PageSize=1000&Page=1&PageToken=PA1`,
    ]);
  });

  it("sends Basic auth with the configured username and password", async () => {
    const seen = stub(() => json({ incoming_phone_numbers: [], next_page_uri: null }));
    await listOwnedNumbers(CFG);
    expect(seen[0]!.headers.get("authorization")).toBe(`Basic ${btoa("SK456:secret")}`);
  });

  it("maps Twilio failures to a TwilioError kind, carrying Twilio's message", async () => {
    stub(() => json({ code: 20003, message: "Authenticate" }, 401));
    const auth = await listOwnedNumbers(CFG).catch((e) => e);
    expect(auth).toBeInstanceOf(TwilioError);
    expect(auth.kind).toBe("auth");

    stub(() => json({ message: "The requested resource was not found" }, 404));
    expect((await listOwnedNumbers(CFG).catch((e) => e)).kind).toBe("not_found");

    stub(() => json({ message: "Internal failure" }, 500));
    const other = await listOwnedNumbers(CFG).catch((e) => e);
    expect(other.kind).toBe("other");
    expect(other.message).toContain("Internal failure");
  });

  it("never puts the secret in an error message", async () => {
    stub(() => new Response("nope", { status: 500 }));
    const error = await listOwnedNumbers(CFG).catch((e) => e);
    expect(error.message).not.toContain("secret");
  });

  it("treats a network failure as kind other", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const error = await listOwnedNumbers(CFG).catch((e) => e);
    expect(error).toBeInstanceOf(TwilioError);
    expect(error.kind).toBe("other");
  });
});

describe("connectNumber", () => {
  it("posts the agent's voice and fallback URLs as a form and returns the updated number", async () => {
    const seen = stub(() => json(raw("PN2", "+14255987522", `${AGENT}/incoming`, `${AGENT}/incoming-fallback`)));

    const number = await connectNumber(CFG, "PN2", `${AGENT}/`);

    expect(seen[0]!.method).toBe("POST");
    expect(seen[0]!.url).toBe(`${BASE}/2010-04-01/Accounts/AC123/IncomingPhoneNumbers/PN2.json`);
    expect(seen[0]!.headers.get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(new URLSearchParams(seen[0]!.body))).toEqual({
      VoiceUrl: `${AGENT}/incoming`,
      VoiceMethod: "POST",
      VoiceFallbackUrl: `${AGENT}/incoming-fallback`,
      VoiceFallbackMethod: "POST",
    });
    expect(number.voiceUrl).toBe(`${AGENT}/incoming`);
  });

  it("refuses a SID that isn't a phone-number SID without calling Twilio", async () => {
    const seen = stub(() => json({}));
    const error = await connectNumber(CFG, "../Calls", AGENT).catch((e) => e);
    expect(error).toBeInstanceOf(TwilioError);
    expect(error.kind).toBe("not_found");
    expect(seen).toHaveLength(0);
  });
});
