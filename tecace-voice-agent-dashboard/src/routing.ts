import { useCallback, useEffect, useState } from "react";
import type { MailboxScope } from "./api/types";
import type { ViewId } from "./components/Sidebar";

// What's on screen, kept in the URL hash rather than in component state.
//
// The point is that a refresh shouldn't throw you back to Overview — but putting it in the address
// bar rather than in localStorage also gets browser back/forward working and makes a view something
// you can send to someone ("here's Sam's analytics"). The hash is used rather than a real path so
// no server rewrite is involved: a stale link can't 404.
//
//   #/analytics
//   #/overview?mailbox=sam%40tecace.com
//   #/overview?mailbox=unattributed        (runs reported before mailboxes existed)
//   #/demos/prospects/<id>                 (a view that addresses one record)
//   #/demos/prospects/<id>/share           (…and which of its tabs is open)
//   #/business/transfers                   (a settings section, optional)
//   #/business?customer=sam%40tecace.com   (which business an admin is viewing)
//   #/dashboard?customer=sam%40tecace.com  (…also on Dashboard › Overview)

// Every view's path. A Record, so a view missing here is a compile error rather than a page that
// silently falls back to Overview on refresh (which is what happened to API keys). `:id` marks the
// one segment a view carries a record id in; `:section?` an optional settings section, and `:tab?`
// an optional prospect tab — or a settings section, which is on the Settings tab.
const PATHS: Record<ViewId, string> = {
  dashboard: "dashboard",
  overview: "overview",
  analytics: "analytics",
  people: "people",
  activity: "activity",
  runs: "runs",
  failed: "failed",
  feedback: "feedback",
  allFeedback: "allFeedback",
  calls: "calls",
  business: "business/:section?",
  numbers: "numbers",
  apiKeys: "apiKeys",
  accounts: "accounts",
  demoOverview: "demos/overview",
  demoProspects: "demos/prospects",
  demoProspect: "demos/prospects/:id/:tab?",
  demoPipeline: "demos/pipeline",
  myOverview: "my/overview",
  myCalls: "my/calls",
  changelog: "changelog",
  billing: "billing",
};

// Where an account lands on sign-in (no hash) and where an unknown address falls back to: the
// receptionist's calls (Dashboard › Overview), not the voicemail Overview.
const DEFAULT_VIEW: ViewId = "dashboard";

/**
 * The settings sections a `:section?` segment may name (`src/settings/sections.ts` renders them).
 * Only these match, so a stray trailing segment still falls back to Overview rather than opening a
 * page on a section that does not exist.
 */
export const SECTION_IDS = [
  "business-info",
  "guided-setup",
  "agent-profile",
  "faqs",
  "take-message",
  "appointments",
  "text-link",
  "transfers",
  "custom-training",
  "test",
  "scenario-tests",
  "launch",
  "forwarding",
] as const;
export type SectionId = (typeof SECTION_IDS)[number];

/** The tabs of a prospect's page (`demos/screens/ProspectScreen.tsx`). None shares a name with a section. */
export const PROSPECT_TABS = ["activity", "settings", "sources", "share"] as const;
export type ProspectTab = (typeof PROSPECT_TABS)[number];
const UNATTRIBUTED = "unattributed";

export interface Route {
  view: ViewId;
  mailbox: MailboxScope;
  /** The record a view addresses (e.g. which prospect); only views with an `:id` path use it. */
  id?: string;
  /** Which settings section is open, on views with a `:section?` or `:tab?` segment. */
  section?: SectionId;
  /** Which tab of a prospect's page is open, when it isn't Settings with a section (that is `section`). */
  tab?: ProspectTab;
  /**
   * Which business an admin is viewing on Business information or Answered calls (its account
   * email). Not the mailbox: that scopes the voicemail views and follows you between them, where
   * this belongs to the page it was picked on — it used to be the mailbox, and leaving the page
   * kept the admin locked into that business everywhere else.
   */
  customer?: string;
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment; // a malformed escape — keep it as typed rather than failing the whole route
  }
}

// Static segments match case-insensitively (as the old list did); an id keeps its case. A trailing
// `:section?` may be absent, and when present must be one of SECTION_IDS; a trailing `:tab?` the
// same, or one of PROSPECT_TABS.
function matchPath(
  pattern: string,
  segments: string[],
): { id?: string; section?: SectionId; tab?: ProspectTab } | null {
  let parts = pattern.split("/");
  const last = parts[parts.length - 1];
  const optional = last === ":section?" || last === ":tab?";
  if (optional && segments.length === parts.length - 1) parts = parts.slice(0, -1);
  if (parts.length !== segments.length) return null;
  let id: string | undefined;
  let section: SectionId | undefined;
  let tab: ProspectTab | undefined;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] ?? "";
    const segment = segments[i] ?? "";
    if (part === ":id") id = segment;
    else if (part === ":section?" || part === ":tab?") {
      const wanted = segment.toLowerCase();
      if ((SECTION_IDS as readonly string[]).includes(wanted)) section = wanted as SectionId;
      else if (part === ":tab?" && (PROSPECT_TABS as readonly string[]).includes(wanted)) tab = wanted as ProspectTab;
      else return null;
    } else if (part.toLowerCase() !== segment.toLowerCase()) return null;
  }
  return {
    ...(id === undefined ? {} : { id }),
    ...(section === undefined ? {} : { section }),
    ...(tab === undefined ? {} : { tab }),
  };
}

export function parseHash(hash: string): Route {
  // "#/demos/prospects/x?mailbox=y" -> segments ["demos","prospects","x"], query "mailbox=y"
  const raw = hash.replace(/^#\/?/, "");
  const [path = "", query = ""] = raw.split("?");
  const segments = path.split("/").filter(Boolean).map(decodeSegment);

  let view: ViewId = DEFAULT_VIEW;
  let id: string | undefined;
  let section: SectionId | undefined;
  let tab: ProspectTab | undefined;
  for (const [candidate, pattern] of Object.entries(PATHS) as [ViewId, string][]) {
    const match = matchPath(pattern, segments);
    if (match) {
      view = candidate;
      id = match.id;
      section = match.section;
      tab = match.tab;
      break;
    }
  }

  const asked = new URLSearchParams(query).get("mailbox")?.trim().toLowerCase();
  const mailbox: MailboxScope = !asked ? undefined : asked === UNATTRIBUTED ? null : asked;
  const customer = new URLSearchParams(query).get("customer")?.trim().toLowerCase() || undefined;

  return {
    view,
    mailbox,
    ...(id === undefined ? {} : { id }),
    ...(section === undefined ? {} : { section }),
    ...(tab === undefined ? {} : { tab }),
    ...(customer === undefined ? {} : { customer }),
  };
}

export function formatHash({ view, mailbox, id, section, tab, customer }: Route): string {
  // An open section is on the Settings tab, so it says both; a tab is written only without one.
  const path = PATHS[view]
    .replace(":id", encodeURIComponent(id ?? ""))
    .replace(/\/:section\?$/, section ? `/${section}` : "")
    .replace(/\/:tab\?$/, section ? `/${section}` : tab ? `/${tab}` : "");
  const scope = mailbox === undefined ? "" : mailbox === null ? UNATTRIBUTED : mailbox;
  const query = [
    ...(scope ? [`mailbox=${encodeURIComponent(scope)}`] : []),
    ...(customer ? [`customer=${encodeURIComponent(customer)}`] : []),
  ].join("&");
  return `#/${path}${query ? `?${query}` : ""}`;
}

/**
 * Where `navigate(next)` goes from `current`: `next` over the current route, except that what
 * belongs to one page doesn't follow you to another. The mailbox is the voicemail views' shared
 * scope and stays; a record id, a section, a tab and the customer an admin picked are dropped on a view change
 * unless `next` names them, and a section is closed when the customer changes.
 */
export function nextRoute(current: Route, next: Partial<Route>): Route {
  const merged: Route = { ...current, ...next };
  if (next.view && next.view !== current.view) {
    if (!("section" in next)) delete merged.section;
    if (!("tab" in next)) delete merged.tab;
    if (!("customer" in next)) delete merged.customer;
    if (!("id" in next)) delete merged.id;
  }
  if ("customer" in next && next.customer !== current.customer && !("section" in next)) delete merged.section;
  // A key present but undefined would otherwise survive into equality checks and history state.
  for (const key of ["id", "section", "tab", "customer"] as const) if (merged[key] === undefined) delete merged[key];
  return merged;
}

// The current route, plus a way to change part of it. Writing to `location.hash` fires
// `hashchange`, which is what feeds the state back — so the URL stays the single source of truth
// instead of a copy that can drift from it.
export function useRoute(): [Route, (next: Partial<Route>, options?: { replace?: boolean }) => void] {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  // Landing with no hash at all: write the default in without adding a history entry, so the first
  // Back press leaves the app rather than going to a URL the user never chose.
  useEffect(() => {
    if (!window.location.hash) {
      window.history.replaceState(null, "", formatHash(parseHash("")));
    }
  }, []);

  // `replace` is for a redirect nobody clicked (a customer landing on their business information):
  // it rewrites the current entry, so Back doesn't return to the page they were redirected from.
  const navigate = useCallback((next: Partial<Route>, options: { replace?: boolean } = {}) => {
    const merged = nextRoute(parseHash(window.location.hash), next);
    const hash = formatHash(merged);
    if (hash === window.location.hash) setRoute(merged); // no hashchange to wait for
    else if (options.replace) {
      window.history.replaceState(null, "", hash); // fires no hashchange either
      setRoute(parseHash(hash));
    } else window.location.hash = hash;
  }, []);

  return [route, navigate];
}
