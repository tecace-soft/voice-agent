/// <reference types="node" />
// Structural checks on the stylesheet entry (the transcribe regression harness proves the
// transcribe screens; this guards the layering the promo screens depend on) and a freshness check
// on the generated scoped preflight.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import tailwind from "@tailwindcss/postcss";
import postcss from "postcss";
import { beforeAll, describe, expect, it } from "vitest";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const entry = join(appRoot, "src", "styles", "index.css");
const require = createRequire(import.meta.url);

/** First position at which each layer name appears in an @layer prelude (statement or block). */
function firstLayerPositions(css: string): Map<string, number> {
  const seen = new Map<string, number>();
  let order = 0;
  for (const m of css.matchAll(/@layer\s+([^{;]+)[{;]/g)) {
    for (const name of m[1]!.split(",").map((n) => n.trim())) {
      if (!seen.has(name)) seen.set(name, order++);
    }
  }
  return seen;
}

describe("styles/index.css (compiled with @tailwindcss/postcss)", () => {
  let css = "";
  beforeAll(async () => {
    const result = await postcss([tailwind({ base: appRoot })]).process(readFileSync(entry, "utf8"), {
      from: entry,
    });
    css = result.css;
  });

  it("declares the layers in cascade order", () => {
    const pos = firstLayerPositions(css);
    const order = ["properties", "theme", "legacy", "base", "utilities"].map((n) => pos.get(n) ?? -1);
    expect(order.every((p) => p >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("scopes preflight, promo base, type scale and utilities to .tw (4 scopes)", () => {
    expect(css.match(/@scope\s*\(\.tw\)/g)?.length).toBe(4);
  });

  it("keeps the promo theme and tw-animate-css (not dropped by a misplaced @import)", () => {
    expect(css).toContain("--ui-background:");
    expect(css).toContain("--ui-primary:");
    // tw-animate-css: its @keyframes live in @theme and are emitted only once an animate-in/out
    // utility is used, but its @property registrations are always emitted.
    expect(css).toContain("@property --tw-enter-opacity");
    // The promo type scale (the transcribe copy in @layer legacy is unscoped).
    expect(css).toMatch(/@scope\s*\(\.tw\)\s*\{\s*\.ta-display-1\s*\{/);
  });

  it("emits utilities only inside the .tw scope", () => {
    const opener = css.search(/@layer\s+utilities\s*\{\s*@scope\s*\(\.tw\)\s*\{/);
    expect(opener).toBeGreaterThan(-1);
    const grids = [...css.matchAll(/\.grid\s*\{\s*display:\s*grid/g)].map((m) => m.index);
    expect(grids.length).toBeGreaterThan(0);
    for (const at of grids) expect(at).toBeGreaterThan(opener);
  });
});

describe("src/styles/ui-preflight.css", () => {
  it("matches the generator's output for the installed tailwindcss", async () => {
    const generator = pathToFileURL(join(appRoot, "scripts", "build-scoped-preflight.mjs")).href;
    const { buildScopedPreflight } = (await import(generator)) as {
      buildScopedPreflight: (preflightCss: string, version: string) => string;
    };
    const preflight = readFileSync(require.resolve("tailwindcss/preflight.css", { paths: [appRoot] }), "utf8");
    const { version } = JSON.parse(
      readFileSync(require.resolve("tailwindcss/package.json", { paths: [appRoot] }), "utf8"),
    ) as { version: string };
    const lf = (s: string) => s.replace(/\r\n/g, "\n");
    const committed = readFileSync(join(appRoot, "src", "styles", "ui-preflight.css"), "utf8");
    expect(lf(committed), "run npm run gen:preflight").toBe(lf(buildScopedPreflight(preflight, version)));
  });
});
