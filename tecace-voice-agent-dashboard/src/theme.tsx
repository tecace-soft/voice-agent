import { useEffect, useState, useSyncExternalStore } from "react";
import { IconMoon, IconSun } from "./icons";
import { applyTheme, readTheme, type Theme } from "./themeCore";

// Light/dark theme, applied to <html> as both `data-theme` and the `.dark` class (see themeCore)
// and persisted so it survives reloads (index.html also applies the saved value before first paint
// to avoid a flash).
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => readTheme(document.documentElement));
  useEffect(() => {
    applyTheme(document.documentElement, theme);
    try {
      localStorage.setItem("theme", theme);
    } catch {
      /* localStorage unavailable — theme just won't persist */
    }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === "dark" ? "light" : "dark"))];
}

// The toggle itself, so the sign-in screen and the dashboard header share one control.
export function ThemeToggle() {
  const [theme, toggle] = useTheme();
  return (
    <button
      type="button"
      className="icon-btn"
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      title={theme === "dark" ? "Light theme" : "Dark theme"}
    >
      {theme === "dark" ? <IconSun size={16} /> : <IconMoon size={16} />}
    </button>
  );
}

// The current theme as a subscribable value, for components that must redraw when it changes
// (Chart.js charts, the toaster). Watches <html data-theme>, which every toggle writes.
function subscribeTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

export function useDocumentTheme(): Theme {
  return useSyncExternalStore(subscribeTheme, () => readTheme(document.documentElement), () => "light");
}
