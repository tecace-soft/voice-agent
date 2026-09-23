import { describe, expect, it } from "vitest";
import { DEFAULT_LANGUAGE, LANGUAGES, languageName, languageOf } from "../../src/demos/lib/languages";
import { buildPrompts, quotedGreeting } from "../../src/demos/lib/prompt";
import type { BusinessProfile } from "../../src/demos/lib/types";

const consulate: BusinessProfile = {
  name: "Consulate General of the Republic of Korea in Seattle",
  category: "Consulate",
  address: "115 111th Ave NE, Bellevue, WA",
  hours: [{ day: "Monday", open: "09:00", close: "16:00" }],
  services: [],
  highlights: [],
  policies: {},
  faqs: [],
};

describe("the language table", () => {
  it("carries English, and English is the default", () => {
    expect(languageOf(DEFAULT_LANGUAGE).label).toBe("English");
    expect(LANGUAGES.some((language) => language.code === "en")).toBe(true);
  });

  it("uses no code twice", () => {
    const codes = LANGUAGES.map((language) => language.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("gives every language a greeting and a sign-off that name the business", () => {
    for (const language of LANGUAGES) {
      const greeting = language.greeting("Hearth & Home", "Ava");
      expect(greeting).toContain("Hearth & Home");
      expect(greeting).toContain("Ava");
      expect(language.signoff("Hearth & Home")).toContain("Hearth & Home");
    }
  });

  it("falls back to English rather than refusing an unknown code", () => {
    for (const bad of [undefined, "", "kr", "klingon"]) {
      expect(languageOf(bad).code).toBe("en");
    }
  });

  it("names a language in both tongues, and only once when they match", () => {
    expect(languageName("ko")).toBe("Korean (한국어)");
    expect(languageName("en")).toBe("English");
  });
});

describe("prompts in the chosen language", () => {
  const korean = buildPrompts(consulate, "Mina", "ko");
  const english = buildPrompts(consulate, "Mina");

  it("writes the greeting in that language, so the rescue can say it aloud", () => {
    expect(quotedGreeting(korean.greeting)).toBe(
      "Consulate General of the Republic of Korea in Seattle입니다. 저는 Mina입니다. 무엇을 도와드릴까요?",
    );
  });

  it("tells the receptionist which language to open in", () => {
    expect(korean.greeting).toContain("Greet them in Korean");
    expect(korean.live).toContain("- Open in Korean.");
    expect(english.live).toContain("- Open in English");
  });

  it("keeps the prompt itself in English, so the operator can still read it", () => {
    expect(korean.live).toContain("You are Mina, the phone receptionist");
    expect(korean.live).toContain("# Personality and tone");
  });

  it("still follows the caller into any other language", () => {
    expect(korean.live).toContain("switch to that language on your very next turn");
    expect(korean.live).toContain("Do not fall back to Korean to be safe");
  });

  it("says English is one of the languages it switches into", () => {
    expect(korean.live).toContain("A caller who speaks English gets English");
    // Pointless to say on an English demo, and it is left out.
    expect(english.live).not.toContain("A caller who speaks English gets English");
  });

  it("does not ask for an American accent in a language that is not English", () => {
    expect(korean.greeting).not.toContain("American accent");
    expect(english.greeting).toContain("American accent");
  });

  it("signs off in the chosen language", () => {
    expect(korean.live).toContain("전화 주셔서 감사합니다");
    expect(english.live).toContain("have a great day");
  });

  it("opens in English when nobody chose, which is what most demos want", () => {
    expect(buildPrompts(consulate, "Mina", undefined).greeting).toEqual(english.greeting);
    expect(buildPrompts(consulate, "Mina", "nonsense").greeting).toEqual(english.greeting);
  });
});
