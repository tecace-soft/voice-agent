import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Vite config for the admin dashboard. Dev server runs on port 5173 by default.
export default defineConfig({
  plugins: [react()],
});
