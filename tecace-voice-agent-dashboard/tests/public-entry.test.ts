/// <reference types="node" />
// What the prospect's document is allowed to contain, and what its links have to look like.
//
// `c.html` is a second entry: the demo page at `/c/<id>` is served by this app but is not a view in
// it. Two things about that arrangement are easy to undo by accident and neither shows up as a
// failing screen, so they are pinned here.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parsePath } from "../src/public/PublicApp";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(appRoot, "src");

/** `@/…` is `src/demos/…`, as vite.config.ts and tsconfig both have it. */
function resolveImport(specifier: string, fromFile: string): string | null {
  const base = specifier.startsWith("@/")
    ? join(src, "demos", specifier.slice(2))
    : specifier.startsWith(".")
      ? resolve(dirname(fromFile), specifier)
      : null; // a package, not our code
  if (!base) return null;
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Every file of ours reachable from an entry, by following static imports. */
function moduleGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    // `import … from "x"`, `export … from "x"`, and `import("x")`.
    for (const m of text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
      const next = resolveImport(m[1]!, file);
      if (next) queue.push(next);
    }
  }
  return seen;
}

const publicGraph = moduleGraph(join(src, "public", "main.tsx"));
const relative = (file: string) => file.slice(appRoot.length + 1).replace(/\\/g, "/");

describe("what the prospect's page is built from", () => {
  it("never reaches the dashboard's session token or its sign-in", () => {
    // Not a security boundary — the two documents share an origin, so any script on it can read
    // localStorage. What this keeps is the admin code out of a public bundle, and it is the kind of
    // thing an innocent-looking import re-adds.
    const forbidden = ["src/api/backend.ts", "src/auth.tsx", "src/App.tsx", "src/demos/api.ts"];
    const reached = [...publicGraph].map(relative).filter((f) => forbidden.includes(f));
    expect(reached).toEqual([]);
  });

  it("does reach the demo page itself, so the check above is not passing on an empty graph", () => {
    const files = [...publicGraph].map(relative);
    expect(files).toContain("src/demos/screens/PublicDemoScreen.tsx");
    expect(files).toContain("src/demos/hooks/useLiveCall.ts");
    expect(files).toContain("src/demos/publicApi.ts");
    expect(files.length).toBeGreaterThan(20);
  });

  it("is a second entry that the dashboard's own entry knows nothing about", () => {
    expect(readFileSync(join(appRoot, "c.html"), "utf8")).toContain("/src/public/main.tsx");
    // Vite builds only index.html unless every input is named.
    const vite = readFileSync(join(appRoot, "vite.config.ts"), "utf8");
    expect(vite).toContain("./c.html");
    expect(vite).toContain("./index.html");
    // And the host has to send /c/* to it, or the path falls through to the dashboard — which is
    // exactly the bug this whole arrangement replaces: the link opened Overview.
    const vercel = JSON.parse(readFileSync(join(appRoot, "vercel.json"), "utf8")) as {
      rewrites: { source: string; destination: string }[];
    };
    const [first] = vercel.rewrites;
    expect(first).toEqual({ source: "/c/:path*", destination: "/c.html" });
  });

  it("is not a view in the dashboard, so it cannot appear in the Demos tabs", () => {
    const routing = readFileSync(join(src, "routing.ts"), "utf8");
    expect(routing).not.toContain('"c/');
    expect(routing).not.toContain("publicDemo");
    const sidebar = readFileSync(join(src, "components", "Sidebar.tsx"), "utf8");
    expect(sidebar).not.toContain("/c/");
  });

  it("needs no environment variable to build a demo link", () => {
    // The bug this replaces: unset, the old `VITE_PUBLIC_DEMO_BASE_URL` fell back to this origin and
    // produced a link that looked right and opened the dashboard's Overview. There is nothing to set
    // now, and nothing may read such a variable again.
    //
    // The *name* still appears in comments and in PORTING.md, which is where the history belongs;
    // what must not come back is a read of it.
    const READ = "import.meta.env.VITE_PUBLIC_DEMO_BASE_URL";
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && readFileSync(p, "utf8").includes(READ)) {
          offenders.push(relative(p));
        }
      }
    };
    walk(src);
    expect(offenders).toEqual([]);
    expect(readFileSync(join(appRoot, ".env.example"), "utf8")).not.toContain(
      "VITE_PUBLIC_DEMO_BASE_URL",
    );
  });
});

describe("which demo a link is for", () => {
  it("reads the three public pages", () => {
    expect(parsePath("/c/ix-TJazEwZw9")).toEqual({ id: "ix-TJazEwZw9", page: "demo" });
    expect(parsePath("/c/ix-TJazEwZw9/scenarios")).toEqual({
      id: "ix-TJazEwZw9",
      page: "scenarios",
    });
    expect(parsePath("/c/ix-TJazEwZw9/pricing")).toEqual({ id: "ix-TJazEwZw9", page: "pricing" });
    // A trailing slash is the same page; `filter(Boolean)` drops the empty segment.
    expect(parsePath("/c/ix-TJazEwZw9/")).toEqual({ id: "ix-TJazEwZw9", page: "demo" });
  });

  it("treats anything else as a link that is not a demo", () => {
    for (const path of [
      "/",
      "/c",
      "/c/",
      "/overview",
      "/c/abc/nonsense",
      "/c/abc/scenarios/extra",
      "/c/abc/pricing/extra",
    ]) {
      expect(parsePath(path)).toBeNull();
    }
  });

  it("refuses an id that would not be safe to put in an API path", () => {
    // These would otherwise be spliced into `<backend>/demo/public/customers/<id>`.
    for (const path of [
      "/c/..%2F..%2Fanalytics",
      "/c/a.b",
      "/c/a b",
      "/c/%E0%A4%A",           // a malformed escape
      "/c/a%2Fb",
    ]) {
      expect(parsePath(path)).toBeNull();
    }
  });
});
