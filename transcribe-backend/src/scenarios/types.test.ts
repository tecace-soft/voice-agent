import { describe, expect, it } from "bun:test";

// What an admin may save as a scenario. Bad input is refused with a message the section can show;
// everything else is trimmed and clamped, never stored as typed.
//
// Run: bun test src/scenarios/types.test.ts
process.env.DATABASE_URL ??= "postgres://unused/unused";
process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret-0123";

const { DefinitionError, readDefinition } = await import("./types.js");

describe("readDefinition", () => {
  it("keeps a full definition", () => {
    const def = readDefinition({
      customerLines: [" Book me for {slotA.spoken}. ", "Yes."],
      language: "ko",
      world: { fullSlots: ["{slotA}"], failTool: "book_appointment", transferAnswer: "declined" },
      expect: {
        tools: [{ name: "book_appointment", args: { start: "{slotA}" }, times: 1 }],
        forbidden: ["transfer_call"],
        final: { bookings: 0, messages: 0 },
        judge: ["Says it is full"],
      },
    });
    expect(def.customerLines).toEqual(["Book me for {slotA.spoken}.", "Yes."]);
    expect(def.language).toBe("ko");
    expect(def.world).toEqual({ fullSlots: ["{slotA}"], failTool: "book_appointment", transferAnswer: "declined" });
    expect(def.expect.tools).toEqual([{ name: "book_appointment", args: { start: "{slotA}" }, times: 1 }]);
    expect(def.expect.final).toEqual({ bookings: 0, messages: 0 });
  });

  it("caps lines at three and defaults the language to English", () => {
    const def = readDefinition({ customerLines: ["a", "b", "c", "d"], world: {}, expect: {} });
    expect(def.customerLines).toEqual(["a", "b", "c"]);
    expect(def.language).toBe("en");
  });

  it("refuses no lines and unknown tools", () => {
    expect(() => readDefinition({ customerLines: [] })).toThrow(DefinitionError);
    expect(() => readDefinition({ customerLines: ["hi"], expect: { tools: [{ name: "send_email" }] } })).toThrow(
      'expect.tools: unknown tool "send_email".',
    );
    expect(() => readDefinition({ customerLines: ["hi"], world: { failTool: "nope" } })).toThrow(DefinitionError);
  });

  it("refuses null input, a bad forbidden tool, a bad times and a bad transferAnswer", () => {
    expect(() => readDefinition(null)).toThrow("Add at least one customer line.");
    expect(() => readDefinition({ customerLines: ["hi"], expect: { forbidden: ["nope"] } })).toThrow(DefinitionError);
    expect(() => readDefinition({ customerLines: ["hi"], expect: { tools: [{ name: "end_call", times: 21 }] } })).toThrow(
      "expect.tools: times must be a whole number from 0 to 20.",
    );
    expect(() => readDefinition({ customerLines: ["hi"], expect: { tools: [{ name: "end_call", times: "1" }] } })).toThrow(
      DefinitionError,
    );
    expect(() => readDefinition({ customerLines: ["hi"], world: { transferAnswer: "maybe" } })).toThrow(
      "world.transferAnswer must be accepted, declined or no_answer.",
    );
  });

  it("gives empty world and expect when left out, and trims arg keys", () => {
    const def = readDefinition({ customerLines: ["hi"] });
    expect(def.world).toEqual({});
    expect(def.expect).toEqual({});
    const d2 = readDefinition({
      customerLines: ["hi"],
      expect: { tools: [{ name: "book_appointment", args: { " start ": "x", "  ": "y" } }] },
    });
    expect(d2.expect.tools).toEqual([{ name: "book_appointment", args: { start: "x" } }]);
  });
});
