/**
 * Scroll the nearest scroll container to its end, and nothing else.
 *
 * `element.scrollIntoView()` scrolls every scrollable ancestor it needs to,
 * the document included, so a transcript that lives in a cropped frame or
 * below the fold would yank the whole page on every fragment. This walks up
 * to the first ancestor that actually scrolls and moves only that. When
 * there is none it does nothing — the window is never a fallback.
 *
 * The element type is structural so the behaviour is unit-testable without
 * a DOM: a container is anything with a parent and the four scroll fields.
 */
export type ScrollNode = {
  parentElement: ScrollNode | null;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

type Style = { overflowY: string };

const SCROLLS = new Set(["auto", "scroll"]);

function computed(node: ScrollNode): Style {
  return getComputedStyle(node as unknown as Element);
}

export function scrollToEnd(
  marker: ScrollNode | null,
  getStyle: (node: ScrollNode) => Style = computed,
): boolean {
  let node = marker?.parentElement ?? null;
  while (node) {
    if (SCROLLS.has(getStyle(node).overflowY)) {
      const end = node.scrollHeight - node.clientHeight;
      if (node.scrollTop !== end) node.scrollTop = end;
      return true;
    }
    node = node.parentElement;
  }
  return false;
}
