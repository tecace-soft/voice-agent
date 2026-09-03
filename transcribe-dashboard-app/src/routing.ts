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

const VIEWS: ViewId[] = [
  "overview",
  "analytics",
  "people",
  "activity",
  "runs",
  "failed",
  "feedback",
  "allFeedback",
  "calls",
  "business",
  "numbers",
  "accounts",
];

const DEFAULT_VIEW: ViewId = "overview";
const UNATTRIBUTED = "unattributed";

export interface Route {
  view: ViewId;
  mailbox: MailboxScope;
}

export function parseHash(hash: string): Route {
  // "#/analytics?mailbox=x" -> path "analytics", query "mailbox=x"
  const raw = hash.replace(/^#\/?/, "");
  const [path, query = ""] = raw.split("?");
  const view = VIEWS.find((v) => v.toLowerCase() === (path ?? "").toLowerCase()) ?? DEFAULT_VIEW;

  const asked = new URLSearchParams(query).get("mailbox")?.trim().toLowerCase();
  const mailbox: MailboxScope = !asked ? undefined : asked === UNATTRIBUTED ? null : asked;

  return { view, mailbox };
}

export function formatHash({ view, mailbox }: Route): string {
  const scope = mailbox === undefined ? "" : mailbox === null ? UNATTRIBUTED : mailbox;
  return `#/${view}${scope ? `?mailbox=${encodeURIComponent(scope)}` : ""}`;
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
