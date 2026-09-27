import { createContext, useContext, useLayoutEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

// The app's chrome — the sidebar and the top bar — as something a page can ask to change.
//
// The settings studio (src/settings/SettingsShell.tsx) wants the whole screen: while it is open the
// sidebar folds to an icon rail, the content area loses its padding and width cap, and the top bar's
// "Demo / Detail" crumbs make way for the page's own row (breadcrumb, status, tabs, actions) — one
// bar instead of two. A page asks for that with `useStudioChrome(true)` and fills the bar through
// `TopbarMain` / `TopbarEnd`. Every other view leaves the chrome as it was.

type Chrome = {
  /** Called by a page while it shows the studio; the App folds the sidebar and drops the padding. */
  setStudio: (on: boolean) => void;
  /** The top bar's slots, once mounted. Both are `.tw`, so Tailwind classes work inside them. */
  main: HTMLElement | null;
  end: HTMLElement | null;
};

export const ChromeContext = createContext<Chrome>({ setStudio: () => undefined, main: null, end: null });

/** Ask for the studio's chrome while `active` (and this component is mounted). */
export function useStudioChrome(active: boolean) {
  const { setStudio } = useContext(ChromeContext);
  // Layout effect: the sidebar folds before the first paint, not a frame after it.
  useLayoutEffect(() => {
    if (!active) return;
    setStudio(true);
    return () => setStudio(false);
  }, [active, setStudio]);
}

/** The top bar's middle: breadcrumb, status, tabs. Renders nothing outside the dashboard shell. */
export function TopbarMain({ children }: { children: ReactNode }) {
  const { main } = useContext(ChromeContext);
  return main ? createPortal(children, main) : null;
}

/** The top bar's right, before the theme toggle: save state, publish, the console toggle. */
export function TopbarEnd({ children }: { children: ReactNode }) {
  const { end } = useContext(ChromeContext);
  return end ? createPortal(children, end) : null;
}

/** Whether the top bar's slots exist — false in tests and outside the dashboard shell. */
export function useHasTopbar(): boolean {
  return Boolean(useContext(ChromeContext).main);
}
