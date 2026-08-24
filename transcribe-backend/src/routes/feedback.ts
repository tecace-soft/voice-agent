import { Elysia, t } from "elysia";
import { authenticate, authenticateAdmin, UNAUTHORIZED } from "../auth/guard.js";
import {
  countOpenFeedback,
  insertFeedback,
  listFeedback,
  listFeedbackByUser,
  setFeedbackStatus,
} from "../db/feedback.js";

// Feedback people send from the dashboard.
//
// Anyone signed in can write a note and read back their own. Reading *everyone's* notes, and
// resolving them, is admin-only — same split as accounts.

// Reading everyone's notes is the admin-only half of this controller; sending one is not.
const READ_ALL = "Only an admin can read everyone's feedback.";

const categoryField = t.Union([
  t.Literal("bug"),
  t.Literal("idea"),
  t.Literal("data"),
  t.Literal("other"),
]);

export const feedback = new Elysia({ prefix: "/feedback" })
  // Send a note. The author is taken from the session rather than the body, so nobody can submit
  // as someone else.
  .post(
    "/",
    async ({ body, headers, status }) => {
      const user = await authenticate(headers.authorization);
      if (!user) return status(401, UNAUTHORIZED);

      const record = await insertFeedback({
        userId: user.id,
        authorName: user.name,
        authorEmail: user.email,
        category: body.category,
        message: body.message,
      });
      return status(201, { feedback: record });
    },
    {
      body: t.Object({
        category: categoryField,
        message: t.String({ minLength: 1, maxLength: 4000 }),
      }),
    },
  )

  // Your own notes — what the Feedback page lists under the form.
  .get("/mine", async ({ headers, status }) => {
    const user = await authenticate(headers.authorization);
    if (!user) return status(401, UNAUTHORIZED);
    return { feedback: await listFeedbackByUser(user.id) };
  })

  // Everything anyone has sent, plus the open count the sidebar badges.
  .get("/", async ({ headers, status }) => {
    const caller = await authenticateAdmin(headers.authorization, READ_ALL);
    if ("denied" in caller) return status(caller.denied, caller.body);
    const all = await listFeedback();
    return { feedback: all, open: all.filter((f) => f.status === "open").length };
  })

  // Just the open count — cheap enough to ask for on every dashboard load.
  .get("/open-count", async ({ headers, status }) => {
    const caller = await authenticateAdmin(headers.authorization, READ_ALL);
    if ("denied" in caller) return status(caller.denied, caller.body);
    return { open: await countOpenFeedback() };
  })

  // Work through the list: resolve a note, or reopen one that was resolved too eagerly.
  .post(
    "/:id/status",
    async ({ body, headers, params, status }) => {
      const caller = await authenticateAdmin(headers.authorization, "Only an admin can resolve feedback.");
      if ("denied" in caller) return status(caller.denied, caller.body);

      const record = await setFeedbackStatus(params.id, body.status, caller.user.name);
      if (!record) return status(404, { error: "not_found", message: "No such feedback." });
      return { feedback: record };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ status: t.Union([t.Literal("open"), t.Literal("resolved")]) }),
    },
  );
