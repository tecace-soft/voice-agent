import { describe, expect, it } from "bun:test";

// The files below are verbatim copies of the promo's — that is what lets the numbers and the
// OpenAI handshake this backend serves match the promo by construction rather than by
// re-derivation. This test fails if either side is edited, so a copy cannot quietly drift into a
// reimplementation. Every differing line must be listed in PORTING.md, by line number.
// `header` is how many lines at the top of OUR copy have no counterpart in the promo's file —
// the imports that replace its `process.env` reads with this repo's `config/env.ts`. They are
// skipped before the comparison so the body can still be compared line for line; without that, a
// copy could never gain an import at all, and the only way to keep the line counts equal was to
// staple an import onto the first line of a doc comment. The header lines are themselves listed in
// PORTING.md, and reported line numbers are the ones you would see in an editor.
// `footer` is the same idea at the other end: lines appended past the end of the promo's file.
// `callReview.ts` needs them because two helpers it calls live in other promo modules, and those
// were copied in whole rather than imported. The comparison becomes
// `all.slice(header, all.length - footer)`, so the body between the two is still held to a
// byte-for-byte match — the part worth protecting. A footer could otherwise grow a line at a time
// without anyone noticing, so its extent must also be written in PORTING.md as
// `<file>:<firstFooterLine>-<lastFooterLine>`, and the test asserts that exact string is there.
// The last line of that range is the empty one a trailing newline leaves behind, which is the
// line number an editor shows too.
const PORTED: { ours: string; theirs: string; header?: number; footer?: number }[] = [
  { ours: "src/demo/analytics.ts", theirs: "lib/analytics.ts" },
  { ours: "src/demo/openai.ts", theirs: "lib/openai.ts", header: 2 },
  // No `header` on these two: the promo's files already open with imports, so ours rewrite those
  // specifiers in place rather than adding lines. `callClock.ts` reads no `process.env`.
  { ours: "src/demo/callClock.ts", theirs: "lib/call-clock.ts" },
  { ours: "src/demo/schedule.ts", theirs: "lib/schedule.ts" },
  // No `header` either: the `env` import took over the line that imported `extractJson`, which
  // now lives in the footer along with `transcriptText`.
  { ours: "src/demo/callReview.ts", theirs: "lib/call-review.ts", footer: 44 },
];

const PROMO = String.raw`C:\Users\Michael Knutsen\Documents\projects\test_demo\voiceagent_promo`;

// A missing promo repo used to make every test below return early and pass. That is a silent
// pass on the exact check this file exists to perform, and it fired for real during Task 4:
// a mangled path made `exists()` false and all five comparisons went green while asserting
// nothing. So absence is now a failure, and skipping is a deliberate act with a name.
//
// Set SKIP_PROMO_PARITY=1 on a machine that genuinely has no promo checkout. Nothing else
// turns these tests off.
const SKIP = process.env.SKIP_PROMO_PARITY === "1";
// Paths are built with forward slashes, which Windows accepts. Escaping a backslash through a
// shell, a heredoc and a JS string in sequence is how this file already broke once: a `\\`
// collapsed to `\`, every comparison silently found no file, and five tests went green.
const promoPath = (rel: string) => `${PROMO.replace(/\\/g, "/")}/${rel}`;
const promoRootExists = await Bun.file(promoPath("package.json")).exists();

describe("ported promo modules stay verbatim copies", () => {
  for (const { ours, theirs, header = 0, footer = 0 } of PORTED) {
    it(`${ours} differs from ${theirs} only by the documented lines`, async () => {
      const promoFile = Bun.file(promoPath(theirs));
      if (SKIP) return;
      // Named separately from the file check so the message says which of the two is wrong.
      expect(promoRootExists, `promo repo not found at ${PROMO} — fix the path, or set SKIP_PROMO_PARITY=1`).toBe(true);
      expect(await promoFile.exists(), `${theirs} is missing from the promo repo`).toBe(true);
      const them = (await promoFile.text()).replace(/\r\n/g, "\n").split("\n");
      const all = (await Bun.file(ours).text()).replace(/\r\n/g, "\n").split("\n");
      const porting = await Bun.file("src/demo/PORTING.md").text();
      const name = ours.split("/").pop();
      // Every header line must really be an import or blank, so `header` cannot become a
      // way to hide changed logic at the top of a file.
      for (const line of all.slice(0, header)) expect(line).toMatch(/^(import .*;|)$/);
      // The footer is arbitrary code by design, so what pins it is its size: PORTING.md has to
      // name the exact span, and a line added or removed there moves the span and fails here.
      if (footer) expect(porting).toContain(`${name}:${all.length - footer + 1}-${all.length}`);
      const us = all.slice(header, all.length - footer);
      expect(us.length).toBe(them.length);
      const differing = us
        .map((line, i) => (line === them[i] ? null : i + 1 + header))
        .filter((n): n is number => n !== null);
      for (const line of differing) expect(porting).toContain(`${name}:${line}`);
    });
  }
});
