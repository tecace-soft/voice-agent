import { describe, expect, it } from "vitest";
import { applyTheme, readTheme, type ThemeTarget } from "../src/themeCore";

function fakeRoot(attr: string | null = null, dark = false) {
  const classes = new Set<string>(dark ? ["dark"] : []);
  const attrs = new Map<string, string>(attr ? [["data-theme", attr]] : []);
  const target: ThemeTarget = {
    getAttribute: (name) => attrs.get(name) ?? null,
    setAttribute: (name, value) => void attrs.set(name, value),
    classList: { toggle: (name, force) => (force ? classes.add(name) : classes.delete(name), !!force) },
  };
  return { target, classes, attrs };
}

describe("applyTheme", () => {
  it("sets data-theme and adds .dark for dark", () => {
    const { target, classes, attrs } = fakeRoot();
    applyTheme(target, "dark");
    expect(attrs.get("data-theme")).toBe("dark");
    expect(classes.has("dark")).toBe(true);
  });

  it("sets data-theme and removes .dark for light", () => {
    const { target, classes, attrs } = fakeRoot("dark", true);
    applyTheme(target, "light");
    expect(attrs.get("data-theme")).toBe("light");
    expect(classes.has("dark")).toBe(false);
  });
});

describe("readTheme", () => {
  it("reads dark from data-theme", () => {
    expect(readTheme(fakeRoot("dark").target)).toBe("dark");
  });

  it("treats anything else as light", () => {
    expect(readTheme(fakeRoot().target)).toBe("light");
    expect(readTheme(fakeRoot("sepia").target)).toBe("light");
  });
});
