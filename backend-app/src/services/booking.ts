// Shared booking logic: book a slot (authoritative + conflict-checked) and create the
// Cal.com meeting (invite + link). Used by both PATCH /intake/:id/status (dashboard/agent)
// and the /agent/* tool endpoints (Retell), so the "book then invite" flow lives in one
// place.

import { createMeeting } from "../cal/client.js";
import { env } from "../config/env.js";
import { sendBookingConfirmation } from "./notify.js";
import {
  bookIntake,
  insertIntake,
  setCalUid,
  type BookResult,
  type IntakeInput,
  type IntakeRecord,
} from "../db/intakes.js";

// Book an existing intake at `dateTime` (or its form time if omitted), then create the
// Cal.com meeting best-effort and store its uid. Returns the same shape as bookIntake.
export async function bookExisting(id: string, dateTime?: string): Promise<BookResult> {
  const result = await bookIntake(id, env.schedule.slotMinutes, dateTime);
  if (!result.ok) return result;
  // Best-effort: a Cal.com hiccup must never undo the booking.
  let intake = result.intake;
  const uid = await createMeeting(intake);
  if (uid) intake = (await setCalUid(intake.id, uid)) ?? intake;
  // Send our own confirmation email (SMTP) so it doesn't depend on Cal.com. Best-effort.
  await sendBookingConfirmation(intake);
  return { ok: true, intake };
}

// Create a brand-new lead (an inbound caller with no pre-existing intake) and book it at
// `dateTime` in one step. `input.requestedDate` records the day; `dateTime` is the confirmed
// time to book at. Returns the created+booked record, or a book failure.
export async function createAndBook(
  input: IntakeInput,
  dateTime: string,
): Promise<{ ok: true; intake: IntakeRecord } | { ok: false; reason: string }> {
  const created = await insertIntake(input);
  const result = await bookExisting(created.id, dateTime);
  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true, intake: result.intake };
}
