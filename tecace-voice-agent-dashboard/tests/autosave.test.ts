import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutosaver, type AutosaveState } from "../src/settings/autosave";

// The settings' autosave, without React: when a change is saved, that saves never overlap or drop an
// edit, and what the status line is told at each step.

function setup(opts: { validate?: () => string | null; fail?: () => Error | null } = {}) {
  const states: AutosaveState[] = [];
  const saves: Array<() => void> = [];
  const saver = createAutosaver({
    delay: 1500,
    // Each save waits until the test lets it finish, so a change can land while one is in flight.
    save: () =>
      new Promise<void>((resolve, reject) => {
        saves.push(() => {
          const error = opts.fail?.();
          if (error) reject(error);
          else resolve();
        });
      }),
    validate: opts.validate,
    onChange: (state) => states.push(state),
    errorMessage: (e) => (e instanceof Error ? e.message : "failed"),
  });
  const last = () => states[states.length - 1]?.status;
  const finish = async () => {
    saves.shift()?.();
    await vi.advanceTimersByTimeAsync(0);
  };
  return { saver, states, saves, last, finish };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("createAutosaver", () => {
  it("saves once, 1.5 s after the last change", async () => {
    const { saver, saves, last } = setup();
    saver.changed();
    expect(last()).toBe("pending");
    await vi.advanceTimersByTimeAsync(1000);
    saver.changed();
    await vi.advanceTimersByTimeAsync(1000);
    expect(saves).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(500);
    expect(saves).toHaveLength(1);
    expect(last()).toBe("saving");
  });

  it("reports saved, with the time, and is no longer dirty", async () => {
    const { saver, last, states, finish } = setup();
    saver.changed();
    await vi.advanceTimersByTimeAsync(1500);
    await finish();
    expect(last()).toBe("saved");
    expect(states[states.length - 1]?.savedAt).toEqual(expect.any(Number));
    expect(saver.dirty()).toBe(false);
  });

  it("never runs two saves at once, and saves a change made during one right after it", async () => {
    const { saver, saves, last, finish } = setup();
    saver.changed();
    await vi.advanceTimersByTimeAsync(1500);
    expect(saves).toHaveLength(1);

    saver.changed(); // typed while the first save is on its way
    await vi.advanceTimersByTimeAsync(5000);
    expect(saves).toHaveLength(1);
    expect(saver.dirty()).toBe(true);

    // Its pause has long passed, so the second save starts as soon as the first lands.
    await finish();
    expect(saves).toHaveLength(1);
    expect(last()).toBe("saving");
    await finish();
    expect(last()).toBe("saved");
    expect(saver.dirty()).toBe(false);
  });

  it("gives a change made just before a save lands its full pause", async () => {
    const { saver, saves, last, finish } = setup();
    saver.changed();
    await vi.advanceTimersByTimeAsync(1500);
    saver.changed();
    await finish();
    expect(last()).toBe("pending");
    await vi.advanceTimersByTimeAsync(1000);
    expect(saves).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(500);
    expect(saves).toHaveLength(1);
  });

  it("does not save what does not pass, and says why", async () => {
    let problem: string | null = "Your business name is empty.";
    const { saver, saves, states, last } = setup({ validate: () => problem });
    saver.changed();
    await vi.advanceTimersByTimeAsync(1500);
    expect(saves).toHaveLength(0);
    expect(last()).toBe("invalid");
    expect(states[states.length - 1]?.message).toBe("Your business name is empty.");

    problem = null;
    saver.changed();
    await vi.advanceTimersByTimeAsync(1500);
    expect(saves).toHaveLength(1);
  });

  it("flush saves at once, and does nothing when there is nothing new", async () => {
    const { saver, saves, finish } = setup();
    void saver.flush();
    expect(saves).toHaveLength(0);
    saver.changed();
    void saver.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(saves).toHaveLength(1);
    await finish();
    await vi.advanceTimersByTimeAsync(1500);
    expect(saves).toHaveLength(0);
  });

  it("keeps a failed change, says what went wrong, and a retry saves it", async () => {
    let failing = true;
    const { saver, saves, states, last, finish } = setup({ fail: () => (failing ? new Error("Server said no.") : null) });
    saver.changed();
    await vi.advanceTimersByTimeAsync(1500);
    await finish();
    expect(last()).toBe("error");
    expect(states[states.length - 1]?.message).toBe("Server said no.");
    expect(saver.dirty()).toBe(true);

    failing = false;
    void saver.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(saves).toHaveLength(1);
    await finish();
    expect(last()).toBe("saved");
  });

  it("cancel drops a waiting save", async () => {
    const { saver, saves } = setup();
    saver.changed();
    saver.cancel();
    await vi.advanceTimersByTimeAsync(3000);
    expect(saves).toHaveLength(0);
  });
});
