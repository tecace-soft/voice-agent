import { NavLink, Route, Routes } from "react-router-dom";
import { CalendarPage } from "./pages/CalendarPage";
import { ClientsPage } from "./pages/ClientsPage";
import { DayPage } from "./pages/DayPage";
import { PromptPage } from "./pages/PromptPage";

export function App() {
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">TecAce AX — Admin</div>
        <nav className="nav">
          <NavLink to="/" end>
            Clients
          </NavLink>
          <NavLink to="/calendar">Calendar</NavLink>
          <NavLink to="/prompt">Agent Prompt</NavLink>
        </nav>
      </header>
      <main className="content">
        <Routes>
          <Route path="/" element={<ClientsPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/calendar/:date" element={<DayPage />} />
          <Route path="/prompt" element={<PromptPage />} />
          <Route path="*" element={<ClientsPage />} />
        </Routes>
      </main>
    </div>
  );
}
