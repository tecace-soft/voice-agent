import type { CallSettings } from "../business/callSettings.js";
import { bookingTargetFor } from "../calendar/service.js";
import { env } from "../config/env.js";
import { findNumberForUser } from "../db/agentNumbers.js";
import { findProfile } from "../db/businessProfiles.js";
import { findCallSettings, saveCallSettingsDraft } from "../db/callSettings.js";
import * as sessions from "../db/setupSessions.js";
import { OpenAIError } from "../demo/openai.js";
import { agentNameOf } from "../session/prompts.js";
import { createSetupResponse } from "./llm.js";
import { buildSetupInstructions } from "./prompt.js";
import { SETUP_TOOLS, executeSetupTool, type ToolContext } from "./tools.js";
import { SETUP_TOPICS, type SetupChange, type SetupInputItem, type SetupMessage, type SetupSession } from "./types.js";

// One turn of the guided setup interview: the owner's message in, the consultant's reply out, with
// every tool the model called in between run here, on the server, before the reply is sent. One
// blocking request per message and no streaming — the dashboard shows a spinner, and a turn is
// either saved whole or (when OpenAI drops out mid-way) saved as far as it got with a note saying so.
//
// Nothing here publishes. The only setting a turn can change is the call-settings DRAFT, and only
// through executeSetupTool, which runs every write through validateCallSettings.

export class SetupTurnError extends Error {
  constructor(
    public code: "empty_message" | "turn_cap" | "turn_in_progress" | "no_profile",
    public status: 400 | 409 | 429,
    message: string,
  ) {
    super(message);
    this.name = "SetupTurnError";
  }
}

export type TurnResult = { session: SetupSession; reply: SetupMessage; draft: CallSettings; dirty: boolean };

const MAX_ROUNDS = 8; // model calls per user message
const CALL_TIMEOUT_MS = 45_000;
const TURN_BUDGET_MS = 110_000; // research already relies on 180 s invocations; stay well inside
/** No new model call is started with less than this left of the budget. */
const MIN_CALL_MS = 5_000;
// Invariant: CLAIM_TTL_S >= TURN_BUDGET_MS / 1000 + 30. Every model call's timeout is capped to what
// is left of the budget, so the last one ends by TURN_BUDGET_MS, and the claim outlives the turn with
// 30 s to spare for the reads and saves around it. Raise the TTL with the budget.
const CLAIM_TTL_S = 150;
const MAX_ITEMS = 400;
const MAX_ITEM_CHARS = 250_000; // transcript trim thresholds
const OPENER =
  "(The owner just opened the setup assistant. Greet them in one or two lines, say what you'll go through, and ask the first question about transfers.)";

const isUserItem = (item: SetupInputItem) => item.type === "message" && item.role === "user";

/**
 * The transcript the model is sent, kept under size by dropping whole exchanges from the front: a
 * user message through to just before the next one. A reasoning / function_call / function_call_output
 * run is never split — the API refuses an output whose call is missing. The latest exchange is kept
 * whatever its size.
 */
function trimItems(items: SetupInputItem[]): SetupInputItem[] {
  let out = items;
  const tooBig = (list: SetupInputItem[]) => list.length > MAX_ITEMS || JSON.stringify(list).length > MAX_ITEM_CHARS;
  while (tooBig(out)) {
    const next = out.findIndex((item, i) => i > 0 && isUserItem(item));
    if (next < 0) break;
    out = out.slice(next);
  }
  return out;
}

const TURN_IN_PROGRESS = "Still working on your last message.";

/**
 * Whether this message may be taken on this session, and whether it opens the conversation. "" opens
 * a conversation with nothing in it yet — including one whose opening turn failed, so asking again
 * retries the greeting rather than being refused as empty.
 */
function checkTurn(session: sessions.SetupSessionRow, text: string): { isStart: boolean } {
  const isStart = text === "" && session.messages.length === 0;
  if (text === "" && !isStart) throw new SetupTurnError("empty_message", 400, "Type a message.");
  if (session.turnCount + 1 > env.setupMaxTurns) {
    throw new SetupTurnError(
      "turn_cap",
      429,
      `This conversation has reached its limit of ${env.setupMaxTurns} messages. Reset it to start again; everything saved so far stays in your draft.`,
    );
  }
  return { isStart };
}

export async function runTurn(userId: string, message: string): Promise<TurnResult> {
  const startedAt = Date.now();
  // Before anything is written: an account with nothing to set up must not be left an empty session.
  const profileRow = await findProfile(userId);
  const profile = profileRow?.profile;
  if (!profileRow || !profile) throw new SetupTurnError("no_profile", 409, "Add your business information first.");

  const found =
    (await sessions.findActiveSetupSession(userId)) ??
    (await sessions.createSetupSession(userId, env.setupAssistantModel));

  const text = message.trim();
  // Checked before the claim so a refused message never takes the turn, and again on the row read
  // under the claim below.
  checkTurn(found, text);
  if (!(await sessions.claimSetupTurn(found.id, CLAIM_TTL_S))) {
    throw new SetupTurnError("turn_in_progress", 409, TURN_IN_PROGRESS);
  }

  let session = found;
  let turnCount = found.turnCount + 1;
  let userMessage: SetupMessage[] = [];
  let items: SetupInputItem[] = [];
  let topics = { ...found.topics };
  const changes: SetupChange[] = [];
  let saved = false;

  try {
    // Re-read under the claim. Another tab's turn can save and hand the claim back between the read
    // above and this claim; continuing from the older copy would write over that exchange.
    const fresh = await sessions.findActiveSetupSession(userId);
    if (!fresh || fresh.id !== found.id) throw new SetupTurnError("turn_in_progress", 409, TURN_IN_PROGRESS);
    session = fresh;
    const { isStart } = checkTurn(session, text);
    turnCount = session.turnCount + 1;
    userMessage = isStart ? [] : [{ role: "user", text, at: new Date().toISOString() }];
    // A retried opener (the first one failed) is already the last thing in the transcript.
    const last = session.items.at(-1);
    const openerPending = isStart && last?.type === "message" && last.role === "user" && last.content[0]?.text === OPENER;
    items = openerPending
      ? [...session.items]
      : [
          ...session.items,
          { type: "message", role: "user", content: [{ type: "input_text", text: isStart ? OPENER : text }] },
        ];
    topics = { ...session.topics };

    const [settings, number, calendar] = await Promise.all([
      findCallSettings(userId),
      findNumberForUser(userId),
      bookingTargetFor(userId),
    ]);

    const ctx: ToolContext = {
      // Loaded fresh on every execution, so the second tool in a turn sees the first one's write.
      store: { load: () => findCallSettings(userId), save: (draft) => saveCallSettingsDraft(userId, draft) },
      agentNumber: number?.phoneE164 ?? null,
      calendar,
      profileHours: profile.hours ?? [],
      timeZone: settings.draft.timezone ?? env.timezone,
      topics,
      finished: false,
    };

    let reply = "";
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      const remaining = TURN_BUDGET_MS - (Date.now() - startedAt);
      if (remaining < MIN_CALL_MS) break;
      // Rebuilt every round, so the snapshot in the instructions reflects the tools just run.
      const current = await ctx.store.load();
      ctx.timeZone = current.draft.timezone ?? env.timezone;
      const instructions = buildSetupInstructions({
        businessName: profileRow.businessName ?? profile.name ?? "",
        profile,
        agentName: agentNameOf(profileRow.agentName),
        draft: current.draft,
        dirty: current.dirty,
        neverPublished: current.published === null,
        agentNumber: ctx.agentNumber,
        calendar,
        timeZone: ctx.timeZone,
        defaultTimeZone: env.timezone,
        topics: ctx.topics,
        turnCount,
        maxTurns: env.setupMaxTurns,
      });

      const res = await createSetupResponse(
        { model: session.model, instructions, input: items, tools: SETUP_TOOLS },
        Math.min(CALL_TIMEOUT_MS, remaining),
      );
      items.push(...res.items);
      if (res.functionCalls.length === 0) {
        reply = res.text;
        break;
      }

      for (const call of res.functionCalls) {
        const outcome = await executeSetupTool(call.name, call.arguments, ctx);
        items.push({ type: "function_call_output", call_id: call.callId, output: JSON.stringify(outcome.output) });
        if (outcome.change) changes.push(outcome.change);
      }
      // Text said alongside tool calls is usually a preamble the next round supersedes. The one
      // exception is a goodbye said with finish_interview: another round would only say it again.
      if (ctx.finished && res.text.trim()) {
        reply = res.text;
        break;
      }
    }

    if (reply === "") {
      reply = changes.length
        ? "I've saved those changes. What would you like to do next?"
        : "Sorry, I lost my thread — could you say that again?";
    }
    // The deterministic end: once no topic is pending the interview is over, whether or not the model
    // remembered finish_interview. Otherwise the session stays active and the finished panel never shows.
    if (!ctx.finished && SETUP_TOPICS.every((t) => ctx.topics[t] !== "pending")) ctx.finished = true;

    const replyMessage: SetupMessage = {
      role: "assistant",
      text: reply,
      at: new Date().toISOString(),
      ...(changes.length ? { changes } : {}),
    };
    const row = await sessions.saveSetupTurn(session.id, {
      items: trimItems(items),
      messages: [...session.messages, ...userMessage, replyMessage],
      topics: ctx.topics,
      turnCount,
      finished: ctx.finished,
    });
    saved = true;

    const final = await findCallSettings(userId);
    return { session: sessions.toPublicSession(row, env.setupMaxTurns), reply: replyMessage, draft: final.draft, dirty: final.dirty };
  } catch (err) {
    if (err instanceof OpenAIError && !saved) {
      // Keep what happened: the owner's message, and anything already written to the draft, so the
      // chat says what was saved rather than looking as if nothing was.
      const note: SetupMessage[] = changes.length
        ? [
            {
              role: "assistant",
              text: `I saved: ${changes.map((c) => c.label).join("; ")}. Then I lost the connection — say "continue" and I'll carry on.`,
              at: new Date().toISOString(),
              changes,
            },
          ]
        : [];
      try {
        await sessions.saveSetupTurn(session.id, {
          items: trimItems(items),
          messages: [...session.messages, ...userMessage, ...note],
          topics,
          turnCount,
          finished: false,
        });
        saved = true;
      } catch (saveErr) {
        // The row can be gone (the account deleted mid-turn). The OpenAI failure is still what the
        // owner must hear; `finally` hands the claim back if the row is there.
        console.error("[setup] could not save the interrupted turn:", saveErr);
      }
    }
    throw err;
  } finally {
    // saveSetupTurn clears the claim; anything that failed before a save hands the turn back here.
    if (!saved) await sessions.releaseSetupTurn(session.id).catch(() => undefined);
  }
}
