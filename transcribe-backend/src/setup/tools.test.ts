import { describe, expect, it } from "bun:test";
import {
  DEFAULT_COLLECT_BEFORE,
  DEFAULT_HOLD_MUSIC,
  emptyCallSettings,
  readCallSettings,
  sameSettings,
  validateCallSettings,
  type CallSettings,
  type TransferScenario,
} from "../business/callSettings.js";
import type { StoredCallSettings } from "../db/callSettings.js";
import { pendingTopics } from "./types.js";
import { executeSetupTool, profileHoursToWindows, SETUP_TOOLS, summarizeDraft, type ToolContext } from "./tools.js";

// The setup consultant's function tools, against an in-memory draft. What matters: every write goes
// through the settings screen's own validation, a refusal saves nothing and tells the model why (and
// whose fault it is), and nothing the executors do can throw into the turn.
//
// Run: bun test src/setup/tools.test.ts

const AGENT = "+12065550100";

/** A draft store that behaves like src/db/callSettings.ts: saved as given, `dirty` against empty. */
function memoryStore(initial: CallSettings = emptyCallSettings()) {
  const state = { draft: initial, saves: 0 };
  const stored = (draft: CallSettings): StoredCallSettings => ({
    draft: readCallSettings(draft),
    published: null,
    publishedAt: null,
    dirty: !sameSettings(draft, emptyCallSettings()),
    waterfallAllowed: false,
  });
  return {
    state,
    store: {
      load: async () => stored(structuredClone(state.draft)),
      save: async (draft: CallSettings) => {
        // What the route would hand it is already validated; checking again here proves it.
        state.draft = validateCallSettings(draft, { agentNumber: AGENT, waterfallAllowed: false });
        state.saves += 1;
        return stored(state.draft);
      },
    },
  };
}

function context(initial?: CallSettings, overrides: Partial<ToolContext> = {}) {
  const memory = memoryStore(initial);
  const ctx: ToolContext = {
    store: memory.store,
    agentNumber: AGENT,
    calendar: null,
    profileHours: [{ day: "Mon", open: "9am", close: "5 pm" }],
    timeZone: "America/Los_Angeles",
    topics: pendingTopics(),
    finished: false,
    ...overrides,
  };
  return { ctx, state: memory.state };
}

const run = (name: string, args: unknown, ctx: ToolContext) =>
  executeSetupTool(name, typeof args === "string" ? args : JSON.stringify(args), ctx);

function transfer(overrides: Partial<TransferScenario>): TransferScenario {
  return {
    id: "front",
    enabled: true,
    mode: "cold",
    name: "Front desk",
    description: "",
    numbers: ["+12065550134"],
    collectBefore: "",
    holdMusic: DEFAULT_HOLD_MUSIC,
    hours: [],
    ...overrides,
  };
}

function withTransfers(...scenarios: TransferScenario[]): CallSettings {
  const settings = emptyCallSettings();
  settings.transfer.scenarios = scenarios;
  return settings;
}

describe("SETUP_TOOLS", () => {
  it("offers exactly the nine tools, in order", () => {
    expect(SETUP_TOOLS.map((t) => t.name)).toEqual([
      "get_current_setup",
      "upsert_transfer_scenario",
      "remove_transfer_scenario",
      "upsert_message_scenario",
      "remove_message_scenario",
      "set_appointments",
      "set_timezone",
      "mark_topic",
      "finish_interview",
    ]);
    for (const tool of SETUP_TOOLS) {
      expect(tool.type).toBe("function");
      expect(tool.strict).toBe(false);
      expect(tool.parameters.type).toBe("object");
    }
  });
});

describe("upsert_transfer_scenario", () => {
  it("adds a cold transfer with a fresh id and the default hold music", async () => {
    const { ctx, state } = context();
    const result = await run("upsert_transfer_scenario", { name: "Front desk", number: "206 555 0134" }, ctx);

    expect(result.output.ok).toBe(true);
    const saved = state.draft.transfer.scenarios[0]!;
    expect(saved.id).toMatch(/^[A-Za-z0-9_-]{1,40}$/);
    expect(saved.mode).toBe("cold");
    expect(saved.holdMusic).toBe(DEFAULT_HOLD_MUSIC);
    expect(saved.numbers).toEqual(["+12065550134"]);
    expect(saved.enabled).toBe(true);
    expect(result.change).toEqual({
      kind: "transfer",
      op: "add",
      id: saved.id,
      label: 'Transfer "Front desk" → (206) 555-0134',
    });
    expect(result.output.change).toEqual(result.change);
  });

  it("asks first when told to, with the default questions", async () => {
    const { ctx, state } = context();
    const result = await run("upsert_transfer_scenario", { name: "Sam", number: "2065550134", ask_first: true }, ctx);
    expect(result.output.ok).toBe(true);
    expect(state.draft.transfer.scenarios[0]!.mode).toBe("warm");
    expect(state.draft.transfer.scenarios[0]!.collectBefore).toBe(DEFAULT_COLLECT_BEFORE);
  });

  it("refuses an extension, naming the number field, and saves nothing", async () => {
    const { ctx, state } = context();
    const result = await run("upsert_transfer_scenario", { name: "Sam", number: "555-0134 ext 12" }, ctx);
    expect(result.output.ok).toBe(false);
    expect(String(result.output.field)).toEndWith(".numbers[0]");
    expect(result.output.hint).toBeUndefined();
    expect(result.change).toBeUndefined();
    expect(state.saves).toBe(0);
  });

  it("refuses the receptionist's own number", async () => {
    const { ctx, state } = context();
    const result = await run("upsert_transfer_scenario", { name: "Sam", number: "(206) 555-0100" }, ctx);
    expect(result.output.ok).toBe(false);
    expect(String(result.output.message)).toContain("assistant answers on");
    expect(state.saves).toBe(0);
  });

  it("names the missing field when adding without a name or number", async () => {
    const { ctx } = context();
    const noName = await run("upsert_transfer_scenario", { number: "2065550134" }, ctx);
    expect(noName.output).toMatchObject({ ok: false, field: "name" });
    const noNumber = await run("upsert_transfer_scenario", { name: "Sam" }, ctx);
    expect(noNumber.output).toMatchObject({ ok: false, field: "number" });
  });

  it("updates by id and keeps the fields it was not given", async () => {
    const { ctx, state } = context(
      withTransfers(transfer({ description: "Anything urgent.", mode: "warm", collectBefore: "Their name" })),
    );
    const result = await run("upsert_transfer_scenario", { id: "front", number: "425 555 0199" }, ctx);

    expect(result.output.ok).toBe(true);
    const saved = state.draft.transfer.scenarios[0]!;
    expect(saved).toMatchObject({
      id: "front",
      name: "Front desk",
      description: "Anything urgent.",
      mode: "warm",
      collectBefore: "Their name",
      numbers: ["+14255550199"],
    });
    expect(result.change).toMatchObject({ kind: "transfer", op: "update", id: "front" });
  });

  it("refuses an unknown id and lists the ones there are", async () => {
    const { ctx, state } = context(withTransfers(transfer({})));
    const result = await run("upsert_transfer_scenario", { id: "nope", name: "Sam" }, ctx);
    expect(result.output).toMatchObject({ ok: false, ids: ["front"] });
    expect(String(result.output.message)).toContain("No transfer with id nope");
    expect(state.saves).toBe(0);
  });

  it("uses the profile's opening hours when asked to", async () => {
    const { ctx, state } = context();
    const result = await run(
      "upsert_transfer_scenario",
      { name: "Front desk", number: "2065550134", use_business_hours: true, hours: [{ day: "Sunday", open: "1:00", close: "2:00" }] },
      ctx,
    );
    expect(result.output.ok).toBe(true);
    expect(state.draft.transfer.scenarios[0]!.hours).toEqual([{ day: "Monday", open: "09:00", close: "17:00" }]);
  });

  it("blames an existing setting, not the change, when the draft was already invalid", async () => {
    // A draft copied from a demo, before this business was given the number it now answers on.
    const { ctx, state } = context(withTransfers(transfer({ numbers: [AGENT] })));
    const result = await run("upsert_transfer_scenario", { name: "Billing", number: "2065550177" }, ctx);
    expect(result.output.ok).toBe(false);
    expect(result.output.field).toBe("transfer.scenarios[0].numbers[0]");
    expect(String(result.output.hint)).toContain("An existing setting is invalid");
    expect(state.saves).toBe(0);
  });

  it("does not blame an existing setting for a clash the change itself caused", async () => {
    const { ctx } = context(withTransfers(transfer({ id: "a", name: "Sam" }), transfer({ id: "b", name: "Lee", numbers: ["+12065550177"] })));
    const result = await run("upsert_transfer_scenario", { id: "a", number: "2065550177" }, ctx);
    expect(result.output.ok).toBe(false);
    expect(result.output.hint).toBeUndefined();
  });
});

describe("remove_transfer_scenario", () => {
  it("removes by id", async () => {
    const { ctx, state } = context(withTransfers(transfer({})));
    const result = await run("remove_transfer_scenario", { id: "front" }, ctx);
    expect(result.output.ok).toBe(true);
    expect(state.draft.transfer.scenarios).toEqual([]);
    expect(result.change).toEqual({ kind: "transfer", op: "remove", id: "front", label: 'Removed transfer "Front desk"' });
  });

  it("refuses an unknown id", async () => {
    const { ctx } = context(withTransfers(transfer({})));
    const result = await run("remove_transfer_scenario", { id: "nope" }, ctx);
    expect(result.output).toMatchObject({ ok: false, ids: ["front"] });
  });
});

describe("message scenarios", () => {
  it("adds, updates and removes one", async () => {
    const { ctx, state } = context();
    const added = await run("upsert_message_scenario", { name: "Quote request", brief: "Ask for the address." }, ctx);
    expect(added.output.ok).toBe(true);
    const id = state.draft.messages.scenarios[0]!.id;
    expect(added.change).toEqual({ kind: "message", op: "add", id, label: 'Message situation "Quote request"' });

    const updated = await run("upsert_message_scenario", { id, enabled: false }, ctx);
    expect(updated.output.ok).toBe(true);
    expect(state.draft.messages.scenarios[0]).toMatchObject({ id, enabled: false, brief: "Ask for the address." });

    const removed = await run("remove_message_scenario", { id }, ctx);
    expect(removed.change?.label).toBe('Removed message situation "Quote request"');
    expect(state.draft.messages.scenarios).toEqual([]);
  });

  it("names the missing brief, and refuses an unknown id", async () => {
    const { ctx } = context();
    expect((await run("upsert_message_scenario", { name: "After hours" }, ctx)).output).toMatchObject({ ok: false, field: "brief" });
    expect((await run("upsert_message_scenario", { id: "x", brief: "b" }, ctx)).output).toMatchObject({ ok: false, ids: [] });
  });
});

describe("set_appointments", () => {
  it("saves the rules and says booking waits for a calendar when none is connected", async () => {
    const { ctx, state } = context();
    const result = await run("set_appointments", { enabled: true, duration_minutes: 45, horizon_days: 14 }, ctx);
    expect(result.output.ok).toBe(true);
    expect(String(result.output.note)).toContain("Appointments");
    expect(state.draft.appointments).toMatchObject({ enabled: true, durationMinutes: 45, horizonDays: 14 });
    expect(result.change).toEqual({ kind: "appointments", op: "update", label: "Appointments: on, 45 min, up to 14 days ahead" });
  });

  it("adds no note when a calendar is connected", async () => {
    const { ctx } = context(undefined, { calendar: { providerName: "Google Calendar", kind: "calendar" } });
    const result = await run("set_appointments", { enabled: true }, ctx);
    expect(result.output.ok).toBe(true);
    expect(result.output.note).toBeUndefined();
  });

  it("refuses an out-of-range length and says it off", async () => {
    const { ctx, state } = context();
    const bad = await run("set_appointments", { enabled: true, duration_minutes: 2 }, ctx);
    expect(bad.output).toMatchObject({ ok: false, field: "appointments.durationMinutes" });
    expect(bad.output.hint).toBeUndefined();
    expect(state.saves).toBe(0);
    const off = await run("set_appointments", { enabled: false }, ctx);
    expect(off.change?.label).toBe("Appointments: off");
  });
});

describe("set_timezone", () => {
  it("sets a real zone and refuses a made-up one", async () => {
    const { ctx, state } = context();
    const ok = await run("set_timezone", { timezone: "America/Chicago" }, ctx);
    expect(ok.change).toEqual({ kind: "timezone", op: "update", label: "Time zone: America/Chicago" });
    expect(state.draft.timezone).toBe("America/Chicago");
    const bad = await run("set_timezone", { timezone: "Mars/Olympus" }, ctx);
    expect(bad.output).toMatchObject({ ok: false, field: "timezone" });
  });
});

describe("topics and finishing", () => {
  it("marks a topic", async () => {
    const { ctx } = context();
    const result = await run("mark_topic", { topic: "transfers", status: "done" }, ctx);
    expect(result.output).toEqual({ ok: true, topics: { transfers: "done", messages: "pending", appointments: "pending" } });
    expect(ctx.topics.transfers).toBe("done");
    expect((await run("mark_topic", { topic: "billing", status: "done" }, ctx)).output.ok).toBe(false);
  });

  it("finishes, skipping whatever is still pending", async () => {
    const { ctx } = context();
    ctx.topics.transfers = "done";
    const result = await run("finish_interview", {}, ctx);
    expect(result.output.ok).toBe(true);
    expect(String(result.output.next)).toContain("Publish");
    expect(ctx.finished).toBe(true);
    expect(ctx.topics).toEqual({ transfers: "done", messages: "skipped", appointments: "skipped" });
  });
});

describe("failures come back as results, never throws", () => {
  it("malformed JSON, an unknown tool, a store that fails", async () => {
    const { ctx } = context();
    expect((await run("mark_topic", "{not json", ctx)).output).toEqual({ ok: false, message: "Arguments were not valid JSON." });
    expect((await run("delete_everything", {}, ctx)).output).toEqual({ ok: false, message: "Unknown tool." });

    const originalError = console.error;
    console.error = () => {};
    try {
      ctx.store = { load: async () => { throw new Error("db down"); }, save: async () => { throw new Error("db down"); } };
      const result = await run("upsert_transfer_scenario", { name: "Sam", number: "2065550134" }, ctx);
      expect(result.output).toEqual({ ok: false, message: "The draft could not be saved just now. Try again." });
    } finally {
      console.error = originalError;
    }
  });
});

describe("get_current_setup and summarizeDraft", () => {
  it("shows the draft with numbers the way people write them", async () => {
    const { ctx } = context(withTransfers(transfer({})));
    const result = await run("get_current_setup", {}, ctx);
    expect(result.output.ok).toBe(true);
    expect(result.output.agentNumber).toBe("(206) 555-0100");
    expect(result.output.calendar).toBeNull();
    expect(result.output.timeZone).toBe("America/Los_Angeles");
    expect(result.output.transfers).toEqual([
      {
        id: "front",
        name: "Front desk",
        enabled: true,
        number: "(206) 555-0134",
        asksFirst: false,
        collectBefore: "",
        description: "",
        hours: [],
      },
    ]);
  });

  it("reads the draft's own time zone over the context's", () => {
    const settings = emptyCallSettings();
    settings.timezone = "America/New_York";
    const summary = summarizeDraft(settings, { agentNumber: null, calendar: null, timeZone: "America/Los_Angeles", topics: pendingTopics() });
    expect(summary.timeZone).toBe("America/New_York");
    expect(summary.agentNumber).toBeNull();
  });
});

describe("profileHoursToWindows", () => {
  it("maps short days and loose times, and skips closed or blank days", () => {
    expect(
      profileHoursToWindows([
        { day: "Mon", open: "9am", close: "5 pm" },
        { day: "Tue", open: "", close: "" },
        { day: "Sun", open: "10:00", close: "14:00", closed: true },
      ]),
    ).toEqual([{ day: "Monday", open: "09:00", close: "17:00" }]);
  });

  it("splits an overnight range at midnight", () => {
    expect(profileHoursToWindows([{ day: "Friday", open: "6pm", close: "2am" }])).toEqual([
      { day: "Friday", open: "18:00", close: "24:00" },
      { day: "Saturday", open: "00:00", close: "02:00" },
    ]);
  });
});
