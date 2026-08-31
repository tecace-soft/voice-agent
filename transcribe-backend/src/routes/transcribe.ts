import { Elysia, t } from "elysia";
import { authenticate, authenticateAdmin, UNAUTHORIZED } from "../auth/guard.js";
import type { PublicUser } from "../db/users.js";
import { env } from "../config/env.js";
import {
  acknowledgeFailures,
  countUnacknowledged,
  insertFailures,
  listFailures,
} from "../db/failures.js";
import { getTranscribeAnalytics } from "../db/analytics.js";
import {
  getVoicemailStats,
  insertVoicemailRun,
  listMailboxes,
  type MailboxScope,
} from "../db/voicemailRuns.js";

// Transcribe controller: the transcribe-app reports each run here (write, secret-guarded), and a
// signed-in dashboard user reads the aggregate — scoped to the mailbox their account belongs to.
//
// Voicemail data is attributed to the mailbox the transcribe-app fetched it from, and that address
// is what ties it to a person: a `user` sees the runs for the mailbox matching their own account
// email and nothing else. An admin sees every mailbox, or one at a time via ?mailbox=.

// The address an admin passes to isolate the runs reported before mailboxes existed. An account
// email can never equal it (no "@"), so a `user` can't reach those rows by asking for it.
const UNATTRIBUTED = "unattributed";

// Which mailbox this caller may read. A non-admin is pinned to their own address no matter what
// they ask for — the query parameter is only ever a filter for an admin, never a way in.
function scopeFor(user: PublicUser, requested: string | undefined): MailboxScope {
  if (user.role !== "admin") return user.email;
  const asked = requested?.trim().toLowerCase();
  if (!asked) return undefined; // no parameter = every mailbox
  return asked === UNATTRIBUTED ? null : asked;
}

export const transcribe = new Elysia({ prefix: "/transcribe" })
  // The write side keeps its own credential: the transcribe-app has no session, it has a shared key.
  .onBeforeHandle(({ request, headers, status }) => {
    // Only the INGEST endpoint uses the shared key. It was every POST under this prefix, which was
    // fine while /runs was the only one — but a dashboard POST carries a session token, not the
    // key, so a blanket rule would reject the very calls it is not meant to guard. Matching the
    // path keeps /runs exactly as protected as it was, and nothing else inherits that credential.
    const path = new URL(request.url).pathname;
    if (request.method !== "POST" || !path.endsWith("/transcribe/runs")) return;
    if (env.transcribeIngestKey && headers["x-transcribe-key"] !== env.transcribeIngestKey) {
      return status(401, { error: "unauthorized" });
    }
  })

  // Report one finished transcribe-app pass (the RunSummary counts) for a mailbox.
  .post(
    "/runs",
    async ({ body, status }) => {
      const { failures, ...counts } = body;
      const record = await insertVoicemailRun(counts);
      // Best-effort: a run whose counts are stored but whose reasons aren't is still a useful run,
      // and losing the whole report over a detail row would be the worse trade.
      if (failures?.length) {
        await insertFailures(record.id, body.mailboxEmail ?? null, failures);
      }
      return status(201, { status: "recorded", run: record });
    },
    {
      body: t.Object({
        voicemails: t.Integer({ minimum: 0 }),
        processed: t.Integer({ minimum: 0 }),
        skipped: t.Integer({ minimum: 0 }),
        failed: t.Integer({ minimum: 0 }),
        // Why each one failed. Optional so an older transcribe-app keeps reporting through a deploy.
        failures: t.Optional(
          t.Array(
            t.Object({
              filename: t.String({ maxLength: 500 }),
              fromAddr: t.String({ maxLength: 320 }),
              error: t.String({ maxLength: 2000 }),
            }),
            { maxItems: 200 },
          ),
        ),
        // Optional so an older transcribe-app keeps reporting through a deploy; those runs are
        // stored unattributed and only an admin ever sees them.
        mailboxEmail: t.Optional(t.String({ maxLength: 320 })),
      }),
    },
  )

  // Aggregate stats for the dashboard, for whichever mailbox the caller is entitled to.
  .get(
    "/stats",
    async ({ headers, query, status }) => {
      const user = await authenticate(headers.authorization);
      if (!user) return status(401, UNAUTHORIZED);
      const stats = await getVoicemailStats(scopeFor(user, query.mailbox));
      // The cap travels with the stats so the dashboard never hardcodes a number: changing the
      // allowance is an env var on this service, not a frontend deploy. limit 0 = not tracked.
      return { ...stats, cap: { limit: env.monthlyCap, warnAt: env.capWarnAt, overageRate: env.overageRate } };
    },
    { query: t.Object({ mailbox: t.Optional(t.String({ maxLength: 320 })) }) },
  )

  // Why voicemails failed, newest first, plus how many nobody has looked at yet.
  .get(
    "/failures",
    async ({ headers, query, status }) => {
      const user = await authenticate(headers.authorization);
      if (!user) return status(401, UNAUTHORIZED);
      const scope = scopeFor(user, query.mailbox);
      const [failures, unacknowledged] = await Promise.all([
        listFailures(scope),
        countUnacknowledged(scope),
      ]);
      return { failures, unacknowledged };
    },
    { query: t.Object({ mailbox: t.Optional(t.String({ maxLength: 320 })) }) },
  )

  // "I've looked at these" — clears the badge without deleting the history.
  .post(
    "/failures/acknowledge",
    async ({ headers, query, status }) => {
      const user = await authenticate(headers.authorization);
      if (!user) return status(401, UNAUTHORIZED);
      const cleared = await acknowledgeFailures(scopeFor(user, query.mailbox));
      return { cleared };
    },
    { query: t.Object({ mailbox: t.Optional(t.String({ maxLength: 320 })) }) },
  )

  // Deeper analysis for the Analytics view, scoped the same way.
  .get(
    "/analytics",
    async ({ headers, query, status }) => {
      const user = await authenticate(headers.authorization);
      if (!user) return status(401, UNAUTHORIZED);
      return getTranscribeAnalytics(scopeFor(user, query.mailbox));
    },
    { query: t.Object({ mailbox: t.Optional(t.String({ maxLength: 320 })) }) },
  )

  // Which mailboxes have reported anything — the admin's picker. Admin-only: the list of addresses
  // is itself something a `user` has no business enumerating.
  .get("/mailboxes", async ({ headers, status }) => {
    const caller = await authenticateAdmin(
      headers.authorization,
      "Only an admin can see every mailbox.",
    );
    if ("denied" in caller) return status(caller.denied, caller.body);
    return { mailboxes: await listMailboxes() };
  });
