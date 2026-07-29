import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Vite config for the form app. The dev server runs on port 5173 by default.
export default defineConfig({
  plugins: [react()],
});
