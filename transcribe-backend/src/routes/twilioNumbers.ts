import { Elysia, t } from "elysia";
import { authenticateAdmin } from "../auth/guard.js";
import { env } from "../config/env.js";
import { listAgentNumbers, type AgentNumber } from "../db/agentNumbers.js";
import {
  agentIncomingUrl,
  agentStatus,
  connectNumber,
  listOwnedNumbers,
  TwilioError,
  twilioConfigFrom,
  type TwilioNumber,
} from "../twilio/numbers.js";

// The numbers on our Twilio account, beside the Agent numbers list (routes/business.ts /numbers).
//
// That list says whose business a number answers as; this says what we own and where each number
// sends its calls. Admin only, like the list: pointing a line at the agent decides what a stranger
// who dials it hears.

const TWILIO_IS_ADMIN = "Only an admin can manage the agent's phone numbers.";

const NOT_CONFIGURED = {
  error: "twilio_not_configured",
  message: "Twilio isn't connected to the backend. Set TWILIO_ACCOUNT_SID and an API key (TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET) on the backend.",
} as const;

const NO_AGENT_URL = {
  error: "agent_url_not_configured",
  message: "The voice agent's address isn't set on the backend. Set AGENT_PUBLIC_URL (e.g. https://31-97-214-59.sslip.io).",
} as const;

type Registered = Pick<AgentNumber, "id" | "label" | "userId" | "userName" | "userEmail">;

function view(number: TwilioNumber, registered: Map<string, AgentNumber>, agentBase: string | null) {
  const own = registered.get(number.phoneE164);
  const reg: Registered | null = own
    ? { id: own.id, label: own.label, userId: own.userId, userName: own.userName, userEmail: own.userEmail }
    : null;
  return {
    sid: number.sid,
    phoneE164: number.phoneE164,
    friendlyName: number.friendlyName,
    voiceUrl: number.voiceUrl,
    status: agentStatus(number.voiceUrl, agentBase),
    registered: reg,
  };
}

async function registeredByPhone(): Promise<Map<string, AgentNumber>> {
  return new Map((await listAgentNumbers()).map((n) => [n.phoneE164, n]));
}

// A Twilio failure as our answer. `auth` is our configuration being wrong, not the admin's request,
// so it is a 502 with a message that says where to look.
function twilioFailure(err: unknown, status: (code: number, body: unknown) => unknown) {
  if (!(err instanceof TwilioError)) throw err;
  if (err.kind === "auth") {
    return status(502, {
      error: "twilio_auth",
      message: "Twilio rejected the credentials — check TWILIO_ACCOUNT_SID and the API key on the backend.",
    });
  }
  if (err.kind === "not_found") return status(404, { error: "not_found", message: err.message });
  console.error(`[twilio] ${err.message}`);
  return status(502, { error: "twilio_error", message: err.message });
}

export const twilioNumbers = new Elysia({ prefix: "/business/numbers/twilio" })
  // Every number on the account, with where it rings and whether it is in our list. Twilio not being
  // set up is a normal state for a deployment, so it is a 200 with `configured: false` the page shows
  // as a note — not a 503 the browser would log as an error on every visit.
  .get("", async ({ headers, status }) => {
    const caller = await authenticateAdmin(headers.authorization, TWILIO_IS_ADMIN);
    if ("denied" in caller) return status(caller.denied, caller.body);
    const cfg = twilioConfigFrom(env);
    if (!cfg) return { configured: false, agentUrl: null, numbers: [] };

    const agentBase = env.agentPublicUrl || null;
    try {
      const [owned, registered] = await Promise.all([listOwnedNumbers(cfg), registeredByPhone()]);
      return {
        configured: true,
        agentUrl: agentBase ? agentIncomingUrl(agentBase) : null,
        numbers: owned
          .map((n) => view(n, registered, agentBase))
          .sort((a, b) => a.phoneE164.localeCompare(b.phoneE164)),
      };
    } catch (err) {
      return twilioFailure(err, status);
    }
  })

  // Point a number's voice webhook at the agent. A number already ringing somewhere else is only
  // overwritten when the admin says so: that URL may be another service somebody set up on purpose.
  .post(
    "/:sid/connect",
    async ({ body, headers, params, status }) => {
      const caller = await authenticateAdmin(headers.authorization, TWILIO_IS_ADMIN);
      if ("denied" in caller) return status(caller.denied, caller.body);
      const cfg = twilioConfigFrom(env);
      if (!cfg) return status(503, NOT_CONFIGURED);
      const agentBase = env.agentPublicUrl;
      if (!agentBase) return status(503, NO_AGENT_URL);

      try {
        const current = (await listOwnedNumbers(cfg)).find((n) => n.sid === params.sid);
        if (!current) {
          return status(404, { error: "not_found", message: "That number isn't on our Twilio account." });
        }
        if (agentStatus(current.voiceUrl, agentBase) === "elsewhere" && body?.overwrite !== true) {
          return status(409, {
            error: "points_elsewhere",
            message: `${current.friendlyName} currently sends its calls to ${current.voiceUrl}. Connecting it sends them to the agent instead.`,
            voiceUrl: current.voiceUrl,
          });
        }
        const updated = await connectNumber(cfg, current.sid, agentBase);
        return { number: view(updated, await registeredByPhone(), agentBase) };
      } catch (err) {
        return twilioFailure(err, status);
      }
    },
    {
      params: t.Object({ sid: t.String({ maxLength: 64 }) }),
      body: t.Optional(t.Object({ overwrite: t.Optional(t.Boolean()) })),
    },
  );
