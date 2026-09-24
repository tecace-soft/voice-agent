import { ArrowUpRight, Mail, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CONTACT_URL, pricingHref } from "@/lib/links";

/**
 * The standing offer, on every public page. The mailto is built by the caller
 * from the link the server knows — reading window.location would render empty
 * on the server and hydration would keep the empty href.
 *
 * Pricing opens in a new tab like the rest: a call may be live on the page
 * these sit on, and navigating away would hang it up.
 */
export function ContactButtons({
  mailto,
  customerId,
  pricing = true,
  className,
}: {
  mailto: string;
  /** Whose demo this is, so Pricing opens the page that knows the way back. */
  customerId?: string;
  /** False on the pricing page itself. */
  pricing?: boolean;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap gap-2 ${className ?? ""}`}>
      <Button
        nativeButton={false}
        render={<a href={CONTACT_URL} target="_blank" rel="noreferrer" />}
      >
        Talk to us
        <ArrowUpRight className="size-4" />
      </Button>
      {pricing ? (
        <Button
          variant="outline"
          nativeButton={false}
          render={<a href={pricingHref(customerId)} target="_blank" rel="noreferrer" />}
        >
          <Tag className="size-4" />
          Pricing
        </Button>
      ) : null}
      <Button variant="ghost" nativeButton={false} render={<a href={mailto} />}>
        <Mail className="size-4" />
        Email us
      </Button>
    </div>
  );
}
