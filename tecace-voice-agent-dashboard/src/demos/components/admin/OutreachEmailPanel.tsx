import { Copy, Mail } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { customerLink, emailBody, emailSubject, mailtoLink } from "@/lib/share";
import type { Customer } from "@/lib/types";

// Dashboard-only (see PORTING.md): the email half of the promo's SharePanel, on its own tab. The
// link, the demo minutes and the contact moved to the Overview's cards.

export function OutreachEmailPanel({ customer }: { customer: Customer }) {
  const link = customerLink(customer.id);
  const subject = emailSubject(customer.profile.name);
  const body = emailBody(customer.profile.name, customer.contactName, link);
  const to = [customer.contactName, customer.contactEmail].filter(Boolean).join(", ");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="ta-headline-2">Outreach email</h2>
          <p className="ta-caption-1 text-muted-foreground">{to ? `To ${to}` : "No contact on file yet; add one on the Overview."}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" nativeButton={false} render={<a href={mailtoLink(customer.profile.name, customer.contactName, customer.contactEmail, link)} />}>
            <Mail className="size-4" />
            Open in mail app
          </Button>
          <Button
            onClick={() => {
              void navigator.clipboard.writeText(`${subject}\n\n${body}`);
              toast.success("Email copied.");
            }}
          >
            <Copy className="size-4" />
            Copy email
          </Button>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="email-subject" className="ta-label-1">
          Subject
        </Label>
        <Input id="email-subject" readOnly value={subject} aria-label="Email subject" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="email-body" className="ta-label-1">
          Message
        </Label>
        <Textarea id="email-body" readOnly value={body} className="min-h-56" aria-label="Email body" />
      </div>
    </div>
  );
}
