import { describe, expect, it } from "bun:test";
import { createTwilioClient, TwilioError } from "./client.js";

// The Twilio REST client, request by request, against a recording fetch: the right path, Basic auth,
// form-encoded bodies with Twilio's PascalCase names, pagination, and Twilio's error body surfacing as
// a typed error. Nothing leaves the process. Run: bun test src/twilio/client.test.ts

const CREDS = { accountSid: "ACtest000000000000000000000000000", authToken: "tok-secret" };
const BASE = `https://api.twilio.com/2010-04-01/Accounts/${CREDS.accountSid}`;

type Recorded = { method: string; url: string; headers: Headers; form: URLSearchParams | null };

function recorder(respond: (r: Recorded) => Response | Promise<Response>) {
  const calls: Recorded[] = [];
  const fetchImpl = (async (input: any, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const recorded: Recorded = {
      method: init.method ?? "GET",
      url,
      headers: new Headers(init.headers),
      form: init.body ? new URLSearchParams(String(init.body)) : null,
    };
    calls.push(recorded);
    return respond(recorded);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const NUMBER_JSON = {
  sid: "PN1",
  phone_number: "+12065550100",
  friendly_name: "Acme",
  capabilities: { voice: true, sms: true, mms: false, fax: false },
  voice_url: "https://agent.example.com/incoming",
  voice_fallback_url: "",
  status_callback: "",
  sms_url: "",
};

describe("credentials", () => {
  it("signs in with an API key instead of the auth token when one is given", async () => {
    const { calls, fetchImpl } = recorder(() => Response.json({ incoming_phone_numbers: [], next_page_uri: null }));
    await createTwilioClient({ ...CREDS, apiKeySid: "SKtest", apiKeySecret: "key-secret" }, fetchImpl).listIncomingNumbers();

    expect(calls[0]!.url).toBe(`${BASE}/IncomingPhoneNumbers.json?PageSize=1000`);
    expect(calls[0]!.headers.get("authorization")).toBe(`Basic ${Buffer.from("SKtest:key-secret").toString("base64")}`);
  });

  it("works with an API key and no auth token at all", async () => {
    const { calls, fetchImpl } = recorder(() => Response.json({ incoming_phone_numbers: [], next_page_uri: null }));
    await createTwilioClient({ accountSid: CREDS.accountSid, apiKeySid: "SKtest", apiKeySecret: "key-secret" }, fetchImpl).listIncomingNumbers();

    expect(calls[0]!.headers.get("authorization")).toBe(`Basic ${Buffer.from("SKtest:key-secret").toString("base64")}`);
  });
});

describe("listIncomingNumbers", () => {
  it("authenticates with Basic auth, follows next_page_uri and maps Twilio's fields", async () => {
    const { calls, fetchImpl } = recorder((r) =>
      r.url.includes("Page=1")
        ? Response.json({ incoming_phone_numbers: [{ ...NUMBER_JSON, sid: "PN2", phone_number: "+18335550100" }], next_page_uri: null })
        : Response.json({
            incoming_phone_numbers: [NUMBER_JSON],
            next_page_uri: `/2010-04-01/Accounts/${CREDS.accountSid}/IncomingPhoneNumbers.json?PageSize=1000&Page=1&PageToken=PAPN1`,
          }),
    );
    const numbers = await createTwilioClient(CREDS, fetchImpl).listIncomingNumbers();

    expect(calls[0]!.url).toBe(`${BASE}/IncomingPhoneNumbers.json?PageSize=1000`);
    expect(calls[0]!.headers.get("authorization")).toBe(
      `Basic ${Buffer.from(`${CREDS.accountSid}:${CREDS.authToken}`).toString("base64")}`,
    );
    expect(calls[1]!.url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${CREDS.accountSid}/IncomingPhoneNumbers.json?PageSize=1000&Page=1&PageToken=PAPN1`);
    expect(numbers).toEqual([
      {
        sid: "PN1",
        phoneNumber: "+12065550100",
        friendlyName: "Acme",
        capabilities: { voice: true, sms: true, mms: false },
        voiceUrl: "https://agent.example.com/incoming",
        voiceFallbackUrl: null,
        statusCallback: null,
        smsUrl: null,
      },
      expect.objectContaining({ sid: "PN2", phoneNumber: "+18335550100" }),
    ]);
  });
});

describe("searchAvailable", () => {
  it("asks the TollFree or Local list with the area code and normalises capabilities", async () => {
    const { calls, fetchImpl } = recorder(() =>
      Response.json({
        available_phone_numbers: [
          {
            phone_number: "+18335550199",
            friendly_name: "(833) 555-0199",
            locality: null,
            region: null,
            postal_code: null,
            capabilities: { voice: true, SMS: true, MMS: false },
          },
        ],
      }),
    );
    const found = await createTwilioClient(CREDS, fetchImpl).searchAvailable({ type: "tollfree", areaCode: "833", limit: 5 });

    expect(calls[0]!.url).toBe(`${BASE}/AvailablePhoneNumbers/US/TollFree.json?AreaCode=833&PageSize=5`);
    expect(found).toEqual([
      {
        phoneNumber: "+18335550199",
        friendlyName: "(833) 555-0199",
        locality: null,
        region: null,
        postalCode: null,
        capabilities: { voice: true, sms: true, mms: false },
      },
    ]);
  });

  it("uses the Local list and Contains for a local search", async () => {
    const { calls, fetchImpl } = recorder(() => Response.json({ available_phone_numbers: [] }));
    await createTwilioClient(CREDS, fetchImpl).searchAvailable({ type: "local", areaCode: "206", contains: "555" });
    expect(calls[0]!.url).toBe(`${BASE}/AvailablePhoneNumbers/US/Local.json?AreaCode=206&Contains=555&PageSize=20`);
  });
});

describe("buyNumber", () => {
  it("posts a form with the number and every webhook, all POST", async () => {
    const { calls, fetchImpl } = recorder(() => Response.json(NUMBER_JSON, { status: 201 }));
    const bought = await createTwilioClient(CREDS, fetchImpl).buyNumber({
      phoneNumber: "+12065550100",
      friendlyName: "Acme",
      voiceUrl: "https://agent.example.com/incoming",
      voiceFallbackUrl: "https://agent.example.com/incoming-fallback",
      statusCallback: "https://api.example.com/twilio/voice-status",
    });

    const call = calls[0]!;
    expect(call.method).toBe("POST");
    expect(call.url).toBe(`${BASE}/IncomingPhoneNumbers.json`);
    expect(call.headers.get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(call.form!)).toEqual({
      PhoneNumber: "+12065550100",
      FriendlyName: "Acme",
      VoiceUrl: "https://agent.example.com/incoming",
      VoiceMethod: "POST",
      VoiceFallbackUrl: "https://agent.example.com/incoming-fallback",
      VoiceFallbackMethod: "POST",
      StatusCallback: "https://api.example.com/twilio/voice-status",
      StatusCallbackMethod: "POST",
    });
    expect(bought.sid).toBe("PN1");
  });

  it("buys by area code when no exact number is given", async () => {
    const { calls, fetchImpl } = recorder(() => Response.json(NUMBER_JSON, { status: 201 }));
    await createTwilioClient(CREDS, fetchImpl).buyNumber({
      areaCode: "206",
      voiceUrl: "v",
      voiceFallbackUrl: "f",
      statusCallback: "s",
    });
    expect(calls[0]!.form!.get("AreaCode")).toBe("206");
    expect(calls[0]!.form!.has("PhoneNumber")).toBe(false);
    expect(calls[0]!.form!.has("FriendlyName")).toBe(false);
  });
});

describe("updateNumber", () => {
  it("posts only the given fields to the number's own resource", async () => {
    const { calls, fetchImpl } = recorder(() => Response.json(NUMBER_JSON));
    await createTwilioClient(CREDS, fetchImpl).updateNumber("PN1", { statusCallback: "https://api.example.com/twilio/voice-status" });
    expect(calls[0]!.url).toBe(`${BASE}/IncomingPhoneNumbers/PN1.json`);
    expect(Object.fromEntries(calls[0]!.form!)).toEqual({
      StatusCallback: "https://api.example.com/twilio/voice-status",
      StatusCallbackMethod: "POST",
    });
  });
});

describe("fetchNumber", () => {
  it("is null for a number Twilio no longer has", async () => {
    const { fetchImpl } = recorder(() => Response.json({ code: 20404, message: "not found", status: 404 }, { status: 404 }));
    expect(await createTwilioClient(CREDS, fetchImpl).fetchNumber("PN9")).toBeNull();
  });
});

describe("releaseNumber", () => {
  it("deletes the resource and treats an already-gone number as released", async () => {
    const { calls, fetchImpl } = recorder((r) =>
      r.url.endsWith("PNgone.json")
        ? Response.json({ code: 20404, message: "not found", status: 404 }, { status: 404 })
        : new Response(null, { status: 204 }),
    );
    const client = createTwilioClient(CREDS, fetchImpl);
    await client.releaseNumber("PN1");
    await client.releaseNumber("PNgone");
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ["DELETE", `${BASE}/IncomingPhoneNumbers/PN1.json`],
      ["DELETE", `${BASE}/IncomingPhoneNumbers/PNgone.json`],
    ]);
  });
});

describe("createCall", () => {
  it("places a call with inline TwiML, a status callback for every event, and a ring timeout", async () => {
    const { calls, fetchImpl } = recorder(() => Response.json({ sid: "CA1", status: "queued" }, { status: 201 }));
    const created = await createTwilioClient(CREDS, fetchImpl).createCall({
      from: "+12065550100",
      to: "+12065550123",
      twiml: "<Response><Say>Test</Say></Response>",
      statusCallback: "https://api.example.com/twilio/voice-status",
      statusCallbackEvents: ["initiated", "ringing", "answered", "completed"],
      timeoutSeconds: 40,
    });

    const form = calls[0]!.form!;
    expect(calls[0]!.url).toBe(`${BASE}/Calls.json`);
    expect(form.get("From")).toBe("+12065550100");
    expect(form.get("To")).toBe("+12065550123");
    expect(form.get("Twiml")).toBe("<Response><Say>Test</Say></Response>");
    expect(form.get("StatusCallback")).toBe("https://api.example.com/twilio/voice-status");
    expect(form.get("StatusCallbackMethod")).toBe("POST");
    expect(form.getAll("StatusCallbackEvent")).toEqual(["initiated", "ringing", "answered", "completed"]);
    expect(form.get("Timeout")).toBe("40");
    expect(created).toEqual({ sid: "CA1", status: "queued" });
  });
});

describe("errors", () => {
  it("surfaces Twilio's error body as a TwilioError with its code", async () => {
    const { fetchImpl } = recorder(() =>
      Response.json(
        { code: 21422, message: "The phone number is not available", more_info: "https://www.twilio.com/docs/errors/21422", status: 400 },
        { status: 400 },
      ),
    );
    const attempt = createTwilioClient(CREDS, fetchImpl).buyNumber({ phoneNumber: "+1", voiceUrl: "v", voiceFallbackUrl: "f", statusCallback: "s" });
    const error = await attempt.catch((e) => e);
    expect(error).toBeInstanceOf(TwilioError);
    expect(error.status).toBe(400);
    expect(error.code).toBe(21422);
    expect(error.message).toBe("The phone number is not available");
  });

  it("copes with a non-JSON failure", async () => {
    const { fetchImpl } = recorder(() => new Response("<html>bad gateway</html>", { status: 502 }));
    const error = await createTwilioClient(CREDS, fetchImpl).listIncomingNumbers().catch((e) => e);
    expect(error).toBeInstanceOf(TwilioError);
    expect(error.status).toBe(502);
    expect(error.code).toBeNull();
  });
});
