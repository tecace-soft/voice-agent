import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Vite config for the transcribe dashboard. Dev server runs on port 5174 (the admin dashboard
// uses 5173, so both can run at once locally).
export default defineConfig({
  plugins: [react()],
  server: { port: 5174 },
});
