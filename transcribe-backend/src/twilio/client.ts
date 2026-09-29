// The Twilio REST API, as much of it as this backend uses: numbers we own, numbers for sale, buying,
// pointing a number's webhooks somewhere, releasing, and placing a call. Plain fetch with Basic auth and
// form-encoded bodies — the same way every other external call here is made, which is also what lets
// the route tests fake Twilio by swapping `fetch`. No SDK: it would be a large dependency for eight
// requests and two strings of TwiML.
//
// Twilio's fixed vocabulary is kept at this boundary (PascalCase form fields, snake_case JSON, "" for
// an unset URL) and everything above it sees camelCase and null.

export class TwilioError extends Error {
  constructor(
    message: string,
    /** The HTTP status Twilio answered with. */
    readonly status: number,
    /** Twilio's own error code (e.g. 21422 "number not available"), when the body carried one. */
    readonly code: number | null,
    readonly moreInfo: string | null = null,
  ) {
    super(message);
    this.name = "TwilioError";
  }
}

// A type alias, not an interface: it is stored as JSONB, and postgres.js's `sql.json` takes only shapes
// with an index signature, which an object-literal type has and an interface does not.
export type Capabilities = {
  voice: boolean;
  sms: boolean;
  mms: boolean;
};

/** A number in the account (IncomingPhoneNumber). */
export interface TwilioNumber {
  sid: string;
  phoneNumber: string;
  friendlyName: string;
  capabilities: Capabilities;
  voiceUrl: string | null;
  voiceFallbackUrl: string | null;
  statusCallback: string | null;
  smsUrl: string | null;
}

/** A number for sale (AvailablePhoneNumber). */
export interface AvailableNumber {
  phoneNumber: string;
  friendlyName: string;
  locality: string | null;
  region: string | null;
  postalCode: string | null;
  capabilities: Capabilities;
}

/** The webhooks written onto a number. Every method is POST; Twilio's default is GET. */
export interface NumberWebhooks {
  voiceUrl: string;
  voiceFallbackUrl: string;
  statusCallback: string;
  smsUrl?: string;
}

export interface TwilioClient {
  listIncomingNumbers(): Promise<TwilioNumber[]>;
  /** Null when Twilio no longer has the number (released, or never this account's). */
  fetchNumber(sid: string): Promise<TwilioNumber | null>;
  searchAvailable(query: {
    type: "local" | "tollfree";
    areaCode?: string;
    contains?: string;
    /** 1–30; Twilio's page is capped there. Default 20. */
    limit?: number;
  }): Promise<AvailableNumber[]>;
  /** Buy an exact number from a search, or the next one in an area code. Webhooks go in the same request. */
  buyNumber(input: ({ phoneNumber: string } | { areaCode: string }) & { friendlyName?: string } & NumberWebhooks): Promise<TwilioNumber>;
  updateNumber(sid: string, patch: Partial<NumberWebhooks> & { friendlyName?: string }): Promise<TwilioNumber>;
  /** Resolves when the number is gone, including when it already was. */
  releaseNumber(sid: string): Promise<void>;
  createCall(input: {
    from: string;
    to: string;
    twiml: string;
    statusCallback: string;
    statusCallbackEvents: string[];
    timeoutSeconds: number;
  }): Promise<{ sid: string; status: string }>;
}

const API = "https://api.twilio.com";

export function createTwilioClient(
  creds: { accountSid: string; authToken?: string; apiKeySid?: string; apiKeySecret?: string },
  fetchImpl: typeof fetch = fetch,
): TwilioClient {
  const base = `${API}/2010-04-01/Accounts/${creds.accountSid}`;
  // An API key, when given, signs in as itself; the URL still names the account it belongs to.
  const [user, secret] =
    creds.apiKeySid && creds.apiKeySecret ? [creds.apiKeySid, creds.apiKeySecret] : [creds.accountSid, creds.authToken ?? ""];
  const authorization = `Basic ${Buffer.from(`${user}:${secret}`).toString("base64")}`;

  async function request(method: "GET" | "POST" | "DELETE", url: string, form?: URLSearchParams): Promise<any> {
    const headers: Record<string, string> = { authorization, accept: "application/json" };
    if (form) headers["content-type"] = "application/x-www-form-urlencoded";
    // A hung Twilio call must not hang a Vercel function: the other external calls here cap at 30s,
    // and Twilio's own guidance is that its API answers in well under 15.
    const response = await fetchImpl(url, {
      method,
      headers,
      body: form ? form.toString() : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 204) return null;
    const text = await response.text();
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!response.ok) {
      throw new TwilioError(
        typeof body?.message === "string" ? body.message : `Twilio answered ${response.status}`,
        response.status,
        typeof body?.code === "number" ? body.code : null,
        typeof body?.more_info === "string" ? body.more_info : null,
      );
    }
    return body;
  }

  const orNull = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

  function toNumber(raw: any): TwilioNumber {
    return {
      sid: raw.sid,
      phoneNumber: raw.phone_number,
      friendlyName: raw.friendly_name ?? "",
      capabilities: {
        voice: Boolean(raw.capabilities?.voice),
        sms: Boolean(raw.capabilities?.sms),
        mms: Boolean(raw.capabilities?.mms),
      },
      voiceUrl: orNull(raw.voice_url),
      voiceFallbackUrl: orNull(raw.voice_fallback_url),
      statusCallback: orNull(raw.status_callback),
      smsUrl: orNull(raw.sms_url),
    };
  }

  // The webhook fields, each with its method forced to POST — Twilio's default is GET, and the agent's
  // `/incoming` and this backend's `/twilio/*` only answer POST.
  function webhookFields(form: URLSearchParams, patch: Partial<NumberWebhooks>) {
    if (patch.voiceUrl !== undefined) {
      form.set("VoiceUrl", patch.voiceUrl);
      form.set("VoiceMethod", "POST");
    }
    if (patch.voiceFallbackUrl !== undefined) {
      form.set("VoiceFallbackUrl", patch.voiceFallbackUrl);
      form.set("VoiceFallbackMethod", "POST");
    }
    if (patch.statusCallback !== undefined) {
      form.set("StatusCallback", patch.statusCallback);
      form.set("StatusCallbackMethod", "POST");
    }
    if (patch.smsUrl !== undefined) {
      form.set("SmsUrl", patch.smsUrl);
      form.set("SmsMethod", "POST");
    }
  }

  return {
    async listIncomingNumbers() {
      const numbers: TwilioNumber[] = [];
      let url: string | null = `${base}/IncomingPhoneNumbers.json?PageSize=1000`;
      while (url) {
        const page = await request("GET", url);
        for (const raw of page?.incoming_phone_numbers ?? []) numbers.push(toNumber(raw));
        // next_page_uri is a path on the API host, or null on the last page.
        url = typeof page?.next_page_uri === "string" && page.next_page_uri ? `${API}${page.next_page_uri}` : null;
      }
      return numbers;
    },

    async fetchNumber(sid) {
      try {
        return toNumber(await request("GET", `${base}/IncomingPhoneNumbers/${sid}.json`));
      } catch (error) {
        if (error instanceof TwilioError && error.status === 404) return null;
        throw error;
      }
    },

    async searchAvailable(query) {
      const params = new URLSearchParams();
      if (query.areaCode) params.set("AreaCode", query.areaCode);
      if (query.contains) params.set("Contains", query.contains);
      params.set("PageSize", String(Math.min(30, Math.max(1, query.limit ?? 20))));
      const kind = query.type === "tollfree" ? "TollFree" : "Local";
      const page = await request("GET", `${base}/AvailablePhoneNumbers/US/${kind}.json?${params}`);
      return (page?.available_phone_numbers ?? []).map(
        (raw: any): AvailableNumber => ({
          phoneNumber: raw.phone_number,
          friendlyName: raw.friendly_name ?? raw.phone_number,
          locality: orNull(raw.locality),
          region: orNull(raw.region),
          postalCode: orNull(raw.postal_code),
          // This resource spells them SMS/MMS where IncomingPhoneNumbers says sms/mms.
          capabilities: {
            voice: Boolean(raw.capabilities?.voice),
            sms: Boolean(raw.capabilities?.SMS ?? raw.capabilities?.sms),
            mms: Boolean(raw.capabilities?.MMS ?? raw.capabilities?.mms),
          },
        }),
      );
    },

    async buyNumber(input) {
      const form = new URLSearchParams();
      if ("phoneNumber" in input) form.set("PhoneNumber", input.phoneNumber);
      else form.set("AreaCode", input.areaCode);
      if (input.friendlyName) form.set("FriendlyName", input.friendlyName);
      webhookFields(form, input);
      return toNumber(await request("POST", `${base}/IncomingPhoneNumbers.json`, form));
    },

    async updateNumber(sid, patch) {
      const form = new URLSearchParams();
      if (patch.friendlyName !== undefined) form.set("FriendlyName", patch.friendlyName);
      webhookFields(form, patch);
      return toNumber(await request("POST", `${base}/IncomingPhoneNumbers/${sid}.json`, form));
    },

    async releaseNumber(sid) {
      try {
        await request("DELETE", `${base}/IncomingPhoneNumbers/${sid}.json`);
      } catch (error) {
        // Already gone is the state we wanted.
        if (error instanceof TwilioError && error.status === 404) return;
        throw error;
      }
    },

    async createCall(input) {
      const form = new URLSearchParams();
      form.set("From", input.from);
      form.set("To", input.to);
      form.set("Twiml", input.twiml);
      form.set("StatusCallback", input.statusCallback);
      form.set("StatusCallbackMethod", "POST");
      for (const event of input.statusCallbackEvents) form.append("StatusCallbackEvent", event);
      form.set("Timeout", String(input.timeoutSeconds));
      const created = await request("POST", `${base}/Calls.json`, form);
      return { sid: created.sid, status: created.status };
    },
  };
}
