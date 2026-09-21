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
// it. Pass `{ mailbox }` to choose the scope instead (`undefined` = every mailbox).
export function demoHref(view: ViewId, id?: string, scope?: { mailbox: MailboxScope }): string {
  const mailbox = scope ? scope.mailbox : currentMailbox();
  return formatHash(id === undefined ? { view, mailbox } : { view, mailbox, id });
}

function currentMailbox(): MailboxScope {
  return typeof window === "undefined" ? undefined : parseHash(window.location.hash).mailbox;
}
