import { useEffect, useState } from "react";
import { DashboardPage } from "./pages/DashboardPage";

// Light/dark theme, applied via the design system's `data-theme` on <html> and persisted so it
// survives reloads (index.html also applies the saved value before first paint to avoid a flash).
function useTheme(): [("light" | "dark"), () => void] {
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light",
  );
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("theme", theme);
    } catch {
      /* localStorage unavailable — theme just won't persist */
    }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === "dark" ? "light" : "dark"))];
}

export function App() {
  const [theme, toggleTheme] = useTheme();
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">TecAce · Transcribe</div>
        <button
          type="button"
          className="theme-toggle"
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          title={theme === "dark" ? "Light theme" : "Dark theme"}
        >
          {theme === "dark" ? "☀" : "☾"}
        </button>
      </header>
      <main className="content">
        <DashboardPage />
      </main>
    </div>
  );
}
