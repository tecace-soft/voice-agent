import { sql } from "./client.js";
import { jsonb } from "./jsonb.js";
import { emptyCallSettings, readCallSettings, sameSettings, type CallSettings } from "../business/callSettings.js";

// A business's call settings: the draft its screens edit and the copy its phone line uses.
//
// The row is created on first save. A business that has never opened the settings has no row, and
// reads back as empty settings with nothing published — which the phone agent treats exactly as it
// treated everyone before this existed.

export interface StoredCallSettings {
  draft: CallSettings;
  published: CallSettings | null;
  publishedAt: string | null;
  /** Whether the draft differs from what callers get. Drives the Publish button. */
  dirty: boolean;
  waterfallAllowed: boolean;
}

type Row = {
  draft: unknown;
  published: unknown;
  published_at: Date | string | null;
  waterfall_allowed: boolean;
};

function toStored(row: Row | undefined): StoredCallSettings {
  if (!row) {
    return { draft: emptyCallSettings(), published: null, publishedAt: null, dirty: false, waterfallAllowed: false };
  }
  const draft = readCallSettings(row.draft);
  const published = row.published == null ? null : readCallSettings(row.published);
  return {
    draft,
    published,
    publishedAt: row.published_at == null ? null : new Date(row.published_at).toISOString(),
    // Never published counts as dirty only once there is something in the draft: a brand-new
    // business with no scenarios has nothing to publish.
    dirty: published ? !sameSettings(draft, published) : !sameSettings(draft, emptyCallSettings()),
    waterfallAllowed: row.waterfall_allowed,
  };
}

export async function findCallSettings(userId: string): Promise<StoredCallSettings> {
  const [row] = await sql`
    SELECT draft, published, published_at, waterfall_allowed
    FROM business_call_settings WHERE user_id = ${userId}
  `;
  return toStored(row as Row | undefined);
}

/** Save the draft. Callers get nothing new until it is published. */
export async function saveCallSettingsDraft(userId: string, draft: CallSettings): Promise<StoredCallSettings> {
  const [row] = await sql`
    INSERT INTO business_call_settings (user_id, draft, updated_at)
    VALUES (${userId}, ${jsonb(draft)}, now())
    ON CONFLICT (user_id) DO UPDATE SET draft = EXCLUDED.draft, updated_at = now()
    RETURNING draft, published, published_at, waterfall_allowed
  `;
  return toStored(row as Row);
}

/** Make the (re-checked) draft what callers get. The draft is replaced by the checked copy too. */
export async function publishCallSettings(userId: string, checked: CallSettings): Promise<StoredCallSettings> {
  const [row] = await sql`
    UPDATE business_call_settings
    SET draft = ${jsonb(checked)}, published = ${jsonb(checked)}, published_at = now(), updated_at = now()
    WHERE user_id = ${userId}
    RETURNING draft, published, published_at, waterfall_allowed
  `;
  return toStored(row as Row | undefined);
}

/** An admin switching waterfall transfers on or off for an account. */
export async function setWaterfallAllowed(userId: string, allowed: boolean): Promise<StoredCallSettings> {
  const [row] = await sql`
    INSERT INTO business_call_settings (user_id, draft, waterfall_allowed, updated_at)
    VALUES (${userId}, ${jsonb(emptyCallSettings())}, ${allowed}, now())
    ON CONFLICT (user_id) DO UPDATE SET waterfall_allowed = EXCLUDED.waterfall_allowed, updated_at = now()
    RETURNING draft, published, published_at, waterfall_allowed
  `;
  return toStored(row as Row);
}

/**
 * Start a business's draft from its demo, at onboarding. Only over settings nobody has written:
 * like the profile, the copy happens once and never over the customer's edits. A row can exist
 * already without any — an admin switching waterfall on at the sale creates one with an empty
 * draft — and that one still takes the demo's.
 */
export async function seedCallSettingsDraft(userId: string, draft: CallSettings): Promise<void> {
  await sql`
    INSERT INTO business_call_settings (user_id, draft, updated_at)
    VALUES (${userId}, ${jsonb(draft)}, now())
    ON CONFLICT (user_id) DO UPDATE SET draft = EXCLUDED.draft, updated_at = now()
    WHERE business_call_settings.published IS NULL
      AND business_call_settings.draft = ${jsonb(emptyCallSettings())}
  `;
}
