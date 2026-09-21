import { describe, expect, it } from "vitest";
import { scrollToEnd, type ScrollNode } from "../../src/demos/lib/scroll";

/**
 * The suite has no DOM, so a scroll container is a plain object with the
 * four fields scrollToEnd reads and the one it writes. getStyle is injected
 * the same way the browser's getComputedStyle would be.
 */
function node(
  overflowY: string,
  parent: FakeNode | null,
  metrics: Partial<Pick<ScrollNode, "scrollTop" | "scrollHeight" | "clientHeight">> = {},
): FakeNode {
  return {
    overflowY,
    parentElement: parent,
    scrollTop: 0,
    scrollHeight: 100,
    clientHeight: 100,
    ...metrics,
  };
}

type FakeNode = ScrollNode & { overflowY: string; parentElement: FakeNode | null };

const style = (n: ScrollNode) => ({ overflowY: (n as FakeNode).overflowY });

describe("scrollToEnd", () => {
  it("scrolls the nearest auto ancestor, not a farther one", () => {
    const outer = node("auto", null, { scrollHeight: 900, clientHeight: 300 });
    const inner = node("auto", outer, { scrollHeight: 600, clientHeight: 200 });
    const marker = node("visible", inner);

    expect(scrollToEnd(marker, style)).toBe(true);
    expect(inner.scrollTop).toBe(400);
    expect(outer.scrollTop).toBe(0);
  });

  it("treats overflow-y: scroll as a container too", () => {
    const box = node("scroll", null, { scrollHeight: 500, clientHeight: 100 });
    const marker = node("visible", box);

    expect(scrollToEnd(marker, style)).toBe(true);
    expect(box.scrollTop).toBe(400);
  });

  it("walks past visible and hidden ancestors", () => {
    const box = node("auto", null, { scrollHeight: 300, clientHeight: 100 });
    const hidden = node("hidden", box);
    const visible = node("visible", hidden);
    const marker = node("visible", visible);

    expect(scrollToEnd(marker, style)).toBe(true);
    expect(box.scrollTop).toBe(200);
    expect(hidden.scrollTop).toBe(0);
    expect(visible.scrollTop).toBe(0);
  });

  // The whole point: when there is no scroll box, nothing moves — the
  // window is never a fallback.
  it("returns false and writes nothing when no ancestor scrolls", () => {
    const top = node("visible", null, { scrollHeight: 2000, clientHeight: 800 });
    const mid = node("visible", top);
    const marker = node("visible", mid);

    expect(scrollToEnd(marker, style)).toBe(false);
    expect(top.scrollTop).toBe(0);
    expect(mid.scrollTop).toBe(0);
  });

  it("is a no-op when the container is already at the end", () => {
    const box = node("auto", null, { scrollTop: 400, scrollHeight: 500, clientHeight: 100 });
    const marker = node("visible", box);

    expect(scrollToEnd(marker, style)).toBe(true);
    expect(box.scrollTop).toBe(400);
  });

  it("does nothing for a missing element", () => {
    expect(scrollToEnd(null, style)).toBe(false);
  });
});
