// First import, for the same reason as `src/main.tsx`: the built CSS orders cascade layers by first
// appearance (see styles/index.css), so no other CSS may be emitted before it.
import "../styles/index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { StartApp } from "./StartApp";

// The entry `start.html` loads: self-service sign-up at /start. Like `src/public/main.tsx`, no
// `AuthProvider` and no `App` — a stranger signing up does not download the dashboard.

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element #root not found");

createRoot(rootEl).render(
  <StrictMode>
    <StartApp />
  </StrictMode>,
);
