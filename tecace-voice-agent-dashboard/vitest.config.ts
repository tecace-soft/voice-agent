import { defineConfig } from "vitest/config";

// Unit tests only: pure modules, no DOM, no network — the whole suite should stay well under a
// second. Logic a component needs tested goes into a pure module (see src/themeCore.ts).
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
  // vite.config.ts defines this for the app build; a future component test would otherwise hit a
  // ReferenceError the moment it imports anything that reads __PROMO_TARGET__.
  define: { __PROMO_TARGET__: '""' },
});
