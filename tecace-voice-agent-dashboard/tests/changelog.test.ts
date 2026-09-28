import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APP_VERSION, CHANGELOG, visibleReleases } from "../src/changelog";

// The version the sidebar shows and the changelog behind it are one list; these keep it honest.

const semver = (v: string) => v.split(".").map(Number);
const compare = (a: string, b: string) => {
  const [x, y] = [semver(a), semver(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return 0;
};

describe("changelog", () => {
  it("package.json carries the newest release's version", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(pkg.version).toBe(APP_VERSION);
    expect(APP_VERSION).toBe(CHANGELOG[0]!.version);
  });

  it("is newest first, with unique x.y.z versions and real dates", () => {
    const versions = CHANGELOG.map((r) => r.version);
    expect(new Set(versions).size).toBe(versions.length);
    for (const r of CHANGELOG) {
      expect(r.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(r.date))).toBe(false);
      expect(r.title.trim()).not.toBe("");
      expect(r.items.length).toBeGreaterThan(0);
    }
    for (let i = 1; i < CHANGELOG.length; i++) {
      expect(compare(CHANGELOG[i - 1]!.version, CHANGELOG[i]!.version)).toBeGreaterThan(0);
      expect(CHANGELOG[i - 1]!.date >= CHANGELOG[i]!.date).toBe(true);
    }
    expect(CHANGELOG.at(-1)!.version).toBe("0.0.1");
  });

  it("hides operator-only lines, and releases left empty, from customers", () => {
    const everyone = visibleReleases(false);
    expect(everyone.every((r) => r.items.every((i) => !i.admin))).toBe(true);
    expect(everyone.every((r) => r.items.length > 0)).toBe(true);
    expect(visibleReleases(true).flatMap((r) => r.items).length).toBe(CHANGELOG.flatMap((r) => r.items).length);
  });
});
