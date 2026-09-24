import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * Whether an element is on screen, from an IntersectionObserver.
 *
 * Starts as `true` so nothing that keys off "scrolled away" (the sticky
 * call bar) flashes before the first observation. With `once`, the value
 * sticks at `true` after the first sighting — the section-reveal case.
 */
export function useInView<T extends Element>(
  options: IntersectionObserverInit & { once?: boolean } = {},
): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(true);
  const { once, root, rootMargin, threshold } = options;

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.isIntersecting) {
          setInView(true);
          if (once) observer.disconnect();
        } else if (!once) {
          setInView(false);
        }
      },
      { root, rootMargin, threshold },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [once, root, rootMargin, threshold]);

  return [ref, inView];
}
