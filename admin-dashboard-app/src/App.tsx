import { useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { CalendarPage } from "./pages/CalendarPage";
import { ClientsPage } from "./pages/ClientsPage";
import { DayPage } from "./pages/DayPage";
import { PromptPage } from "./pages/PromptPage";
import { TranscriptionsPage } from "./pages/TranscriptionsPage";

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
        <div className="brand">TecAce AX — Admin</div>
        <nav className="nav">
          <NavLink to="/" end>
            Clients
          </NavLink>
          <NavLink to="/calendar">Calendar</NavLink>
          <NavLink to="/transcriptions">Transcriptions</NavLink>
          <NavLink to="/prompt">Agent Prompt</NavLink>
        </nav>
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
        <Routes>
          <Route path="/" element={<ClientsPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/calendar/:date" element={<DayPage />} />
          <Route path="/transcriptions" element={<TranscriptionsPage />} />
          <Route path="/prompt" element={<PromptPage />} />
          <Route path="*" element={<ClientsPage />} />
        </Routes>
      </main>
    </div>
  );
}
