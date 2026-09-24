// First import, for the same reason as `src/main.tsx`: the built CSS orders cascade layers by first
// appearance (see styles/index.css), so no other CSS may be emitted before it.
import "../styles/index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PublicApp } from "./PublicApp";

// The entry `c.html` loads, and the whole of what a prospect downloads.
//
// Compare `src/main.tsx`: there is no `AuthProvider` here and no `App`. That is the point of the
// second entry rather than a route — the dashboard's sign-in, its session token and its admin
// screens are not in this bundle at all.

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element #root not found");

createRoot(rootEl).render(
  <StrictMode>
    <PublicApp />
  </StrictMode>,
);
