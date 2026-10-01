import { describe, expect, it } from "bun:test";

// What the research run is asked to find. The prompts are the whole of the behaviour here — the
// model does the reading — so the test pins the instructions that matter, not the wording around them.
//
// Run: bun test src/demo/research.test.ts
process.env.DATABASE_URL ??= "postgres://unused/unused";
process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret-0123";

const { buildDossierPrompt, buildProfilePrompt } = await import("./research.js");

describe("research: the business's own FAQs", () => {
  const dossier = buildDossierPrompt({ businessName: "Harbor Dental", websiteUrl: "https://harbordental.example" });

  // A customer should not have to retype a FAQ page that already exists on their site.
  it("sends the run to the business's own FAQ pages and has it copy every question with its answer", () => {
    expect(dossier).toMatch(/FAQ page/i);
    expect(dossier).toMatch(/every question/i);
    expect(dossier).toMatch(/Google Business Profile/i);
    // Published ones are kept apart from the ones the run infers for a business like this.
    expect(dossier).toMatch(/published/i);
  });

  it("carries every FAQ into the profile, the published ones first", () => {
    const profile = buildProfilePrompt("Harbor Dental", "## FAQs\n- Do you take new patients? Yes.");
    expect(profile).toMatch(/every FAQ/i);
    expect(profile).toMatch(/published .*first/i);
  });
});
