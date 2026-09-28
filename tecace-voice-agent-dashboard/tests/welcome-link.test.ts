import { afterEach, describe, expect, it, vi } from "vitest";
import { takeLinkFromHash } from "../src/pages/WelcomePage";

// An invite or reset link (#/welcome?token=… / #/reset?token=…): read once, then taken out of the
// address bar so the token isn't left in history.

function fakeWindow(hash: string) {
  const replaceState = vi.fn();
  vi.stubGlobal("window", { location: { hash, pathname: "/", search: "" }, history: { replaceState } });
  return replaceState;
}

afterEach(() => vi.unstubAllGlobals());

describe("sign-in links", () => {
  it("reads an invite and clears the address", () => {
    const replaceState = fakeWindow("#/welcome?token=abc_DEF-123");
    expect(takeLinkFromHash()).toEqual({ token: "abc_DEF-123", purpose: "invite" });
    expect(replaceState).toHaveBeenCalledWith(null, "", "/#/");
  });

  it("reads a reset", () => {
    fakeWindow("#/reset?token=xyz");
    expect(takeLinkFromHash()).toEqual({ token: "xyz", purpose: "reset" });
  });

  it("leaves every other address alone", () => {
    for (const hash of ["", "#/overview", "#/welcome", "#/welcome?other=1", "#/business/faqs"]) {
      const replaceState = fakeWindow(hash);
      expect(takeLinkFromHash()).toBeNull();
      expect(replaceState).not.toHaveBeenCalled();
    }
  });
});
