import type { MailboxScope } from "../api/types";
import type { ViewId } from "../components/Sidebar";
import { formatHash, parseHash } from "../routing";

// Stands in for next/link targets in ported promo code: `/admin/customers/<id>` →
// `demoHref("demoProspect", id)`, `/admin/customers` → `demoHref("demoProspects")`,
// `/admin/crm` → `demoHref("demoPipeline")`, `/admin` → `demoHref("demoOverview")`.
// A plain <a href="#/…"> is enough: the hash router picks the change up.
//
// The link keeps the current mailbox scope (read from the hash when the link is rendered), as the
// sidebar's navigate does, so following a promo link and going back to a transcribe view keeps
// it. Pass `{ mailbox }` to choose the scope instead (`undefined` = every mailbox), and `customer`
// to open Business information / Answered calls on that business (its account email).
export function demoHref(
  view: ViewId,
  id?: string,
  scope?: { mailbox?: MailboxScope; customer?: string },
): string {
  const mailbox = scope && "mailbox" in scope ? scope.mailbox : currentMailbox();
  const customer = scope?.customer;
  return formatHash({
    view,
    mailbox,
    ...(id === undefined ? {} : { id }),
    ...(customer === undefined ? {} : { customer }),
  });
}

function currentMailbox(): MailboxScope {
  return typeof window === "undefined" ? undefined : parseHash(window.location.hash).mailbox;
}

// Whether a record id from the URL is safe to put in a demo API path. The promo's ids are nanoids
// (A-Z a-z 0-9 _ -). Anything else — "../../analytics" decoded from the hash, a "/" or "?" — would
// otherwise be spliced into <backend>/demo/customers/<id> and could leave that route.
export function isPromoId(id: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(id);
}
