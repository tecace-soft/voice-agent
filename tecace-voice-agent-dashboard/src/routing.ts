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

// Every view's path. A Record, so a view missing here is a compile error rather than a page that
// silently falls back to Overview on refresh (which is what happened to API keys). `:id` marks the
// one segment a view carries a record id in.
const PATHS: Record<ViewId, string> = {
  overview: "overview",
  analytics: "analytics",
  people: "people",
  activity: "activity",
  runs: "runs",
  failed: "failed",
  feedback: "feedback",
  allFeedback: "allFeedback",
  calls: "calls",
  business: "business",
  numbers: "numbers",
  apiKeys: "apiKeys",
  accounts: "accounts",
  demoOverview: "demos/overview",
  demoProspects: "demos/prospects",
  demoProspect: "demos/prospects/:id",
  demoPipeline: "demos/pipeline",
};

const DEFAULT_VIEW: ViewId = "overview";
const UNATTRIBUTED = "unattributed";

export interface Route {
  view: ViewId;
  mailbox: MailboxScope;
  /** The record a view addresses (e.g. which prospect); only views with an `:id` path use it. */
  id?: string;
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment; // a malformed escape — keep it as typed rather than failing the whole route
  }
}

// Static segments match case-insensitively (as the old list did); an id keeps its case.
function matchPath(pattern: string, segments: string[]): { id?: string } | null {
  const parts = pattern.split("/");
  if (parts.length !== segments.length) return null;
  let id: string | undefined;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] ?? "";
    const segment = segments[i] ?? "";
    if (part === ":id") id = segment;
    else if (part.toLowerCase() !== segment.toLowerCase()) return null;
  }
  return id === undefined ? {} : { id };
}

export function parseHash(hash: string): Route {
  // "#/demos/prospects/x?mailbox=y" -> segments ["demos","prospects","x"], query "mailbox=y"
  const raw = hash.replace(/^#\/?/, "");
  const [path = "", query = ""] = raw.split("?");
  const segments = path.split("/").filter(Boolean).map(decodeSegment);

  let view: ViewId = DEFAULT_VIEW;
  let id: string | undefined;
  for (const [candidate, pattern] of Object.entries(PATHS) as [ViewId, string][]) {
    const match = matchPath(pattern, segments);
    if (match) {
      view = candidate;
      id = match.id;
      break;
    }
  }

  const asked = new URLSearchParams(query).get("mailbox")?.trim().toLowerCase();
  const mailbox: MailboxScope = !asked ? undefined : asked === UNATTRIBUTED ? null : asked;

  return id === undefined ? { view, mailbox } : { view, mailbox, id };
}

export function formatHash({ view, mailbox, id }: Route): string {
  const path = PATHS[view].replace(":id", encodeURIComponent(id ?? ""));
  const scope = mailbox === undefined ? "" : mailbox === null ? UNATTRIBUTED : mailbox;
  return `#/${path}${scope ? `?mailbox=${encodeURIComponent(scope)}` : ""}`;
}

// The current route, plus a way to change part of it. Writing to `location.hash` fires
// `hashchange`, which is what feeds the state back — so the URL stays the single source of truth
// instead of a copy that can drift from it.
export function useRoute(): [Route, (next: Partial<Route>) => void] {
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

  const navigate = useCallback((next: Partial<Route>) => {
    const merged = { ...parseHash(window.location.hash), ...next };
    const hash = formatHash(merged);
    if (hash === window.location.hash) setRoute(merged); // no hashchange to wait for
    else window.location.hash = hash;
  }, []);

  return [route, navigate];
}
