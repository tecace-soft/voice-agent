import { describe, expect, it } from "bun:test";
import { parseForm, twilioSignature, verifyTwilioSignature } from "./signature.js";

// Twilio signs every webhook it sends: HMAC-SHA1 over the exact URL it called plus every POST parameter,
// sorted by name and concatenated key+value, base64. The first vector is the one in Twilio's own
// "Validating signatures" guide (auth token 12345), so this is checked against Twilio, not against
// itself. Run: bun test src/twilio/signature.test.ts

const DOC_URL = "https://mycompany.com/myapp.php?foo=1&bar=2";
const DOC_PARAMS = {
  CallSid: "CA1234567890ABCDE",
  Caller: "+12349013030",
  Digits: "1234",
  From: "+12349013030",
  To: "+18005551212",
};
const DOC_SIGNATURE = "0/KCTR6DLpKmkAf8muzZqo1nDgQ=";

describe("twilioSignature", () => {
  it("matches Twilio's documented example", () => {
    expect(twilioSignature("12345", DOC_URL, DOC_PARAMS)).toBe(DOC_SIGNATURE);
  });

  it("includes blank values, which Twilio sends for an absent ForwardedFrom", () => {
    // Computed independently with Python's hmac over
    // url + "ForwardedFrom" + "" + "From+15550002222" + "To+15550001111".
    const params = { To: "+15550001111", ForwardedFrom: "", From: "+15550002222" };
    expect(twilioSignature("tok-secret", "https://backend.example.com/twilio/voice-status", params)).toBe(
      "yUfl5kn9vAIBLTiDX+0SIWtzjU8=",
    );
  });
});

describe("verifyTwilioSignature", () => {
  it("accepts the documented request", () => {
    expect(
      verifyTwilioSignature({ authToken: "12345", url: DOC_URL, params: DOC_PARAMS, signature: DOC_SIGNATURE }),
    ).toBe(true);
  });

  it("rejects a changed parameter", () => {
    const params = { ...DOC_PARAMS, Digits: "9999" };
    expect(verifyTwilioSignature({ authToken: "12345", url: DOC_URL, params, signature: DOC_SIGNATURE })).toBe(false);
  });

  it("rejects the wrong token", () => {
    expect(
      verifyTwilioSignature({ authToken: "54321", url: DOC_URL, params: DOC_PARAMS, signature: DOC_SIGNATURE }),
    ).toBe(false);
  });

  it("rejects a different URL, query string included", () => {
    const url = "https://mycompany.com/myapp.php?foo=1";
    expect(verifyTwilioSignature({ authToken: "12345", url, params: DOC_PARAMS, signature: DOC_SIGNATURE })).toBe(
      false,
    );
  });

  it("rejects a missing or malformed signature without throwing", () => {
    expect(verifyTwilioSignature({ authToken: "12345", url: DOC_URL, params: DOC_PARAMS, signature: null })).toBe(false);
    expect(verifyTwilioSignature({ authToken: "12345", url: DOC_URL, params: DOC_PARAMS, signature: "" })).toBe(false);
    expect(verifyTwilioSignature({ authToken: "12345", url: DOC_URL, params: DOC_PARAMS, signature: "short" })).toBe(
      false,
    );
  });
});

describe("parseForm", () => {
  it("keeps blank values and decodes what Twilio encodes", () => {
    expect(parseForm("To=%2B15550001111&ForwardedFrom=&CallerName=Jane+Doe")).toEqual({
      To: "+15550001111",
      ForwardedFrom: "",
      CallerName: "Jane Doe",
    });
  });

  it("round-trips through the signature", () => {
    const body = "CallSid=CA1234567890ABCDE&Caller=%2B12349013030&Digits=1234&From=%2B12349013030&To=%2B18005551212";
    expect(twilioSignature("12345", DOC_URL, parseForm(body))).toBe(DOC_SIGNATURE);
  });
});
