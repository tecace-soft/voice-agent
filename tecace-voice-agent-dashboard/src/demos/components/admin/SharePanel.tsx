
import { Copy, ExternalLink, Mail } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { customerLink, emailBody, emailSubject, mailtoLink } from "@/lib/share";
import { DEFAULT_DEMO_MINUTES, type Customer, type CustomerStats } from "@/lib/types";
import { formatDuration } from "@/lib/analytics";

type Props = {
  customer: Customer;
  stats: CustomerStats;
  onChange: (partial: Partial<Customer>) => void;
};

export function SharePanel({ customer, stats, onChange }: Props) {
  const link = customerLink(customer.id);
  const subject = emailSubject(customer.profile.name);
  const body = emailBody(customer.profile.name, customer.contactName, link);
  const minutes = customer.demoMinutes ?? DEFAULT_DEMO_MINUTES;
  const usedSec = stats.totalSec;
  const spent = Math.min(1, minutes > 0 ? usedSec / (minutes * 60) : 1);

  function copy(text: string, message: string) {
    void navigator.clipboard.writeText(text);
    toast.success(message);
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <Label htmlFor="share-link" className="ta-label-1">
          Customer link
        </Label>
        <div className="flex flex-wrap gap-2">
          <Input id="share-link" readOnly value={link} className="min-w-64 flex-1" />
          <Button variant="outline" onClick={() => copy(link, "Link copied.")}>
            <Copy className="size-4" />
            Copy
          </Button>
          <Button
            variant="outline"
            nativeButton={false}
            render={<a href={link} target="_blank" rel="noreferrer" />}
          >
            <ExternalLink className="size-4" />
            Open
          </Button>
        </div>
        <p className="ta-caption-1 text-muted-foreground">
          {customer.active
            ? "The link is live. Anyone with it can call."
            : "The demo is paused, so the link shows an unavailable message."}
        </p>
      </div>

      <Separator />

      <div className="space-y-2">
        <Label htmlFor="demo-minutes" className="ta-label-1">
          Demo minutes
        </Label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id="demo-minutes"
            type="number"
            min={0}
            step={5}
            className="w-28"
            value={minutes}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next)) onChange({ demoMinutes: Math.max(0, next) });
            }}
          />
          <span className="ta-caption-1 text-muted-foreground">
            {formatDuration(usedSec)} used of {minutes}:00
            {usedSec >= minutes * 60 ? " — spent, the call button is closed" : ""}
          </span>
        </div>
        <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
          <div
            className={spent >= 1 ? "bg-destructive h-full" : "bg-primary h-full"}
            style={{ width: `${Math.round(spent * 100)}%` }}
          />
        </div>
        <p className="ta-caption-1 text-muted-foreground">
          When this runs out the demo page stops offering the call and asks them
          to get in touch. Raise the number here to let them carry on. Your own
          test calls do not spend it.
        </p>
      </div>

      <Separator />

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="ta-headline-2">Email</h3>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => copy(`${subject}\n\n${body}`, "Email copied.")}
            >
              <Copy className="size-4" />
              Copy email
            </Button>
            <Button
              variant="outline"
              nativeButton={false}
              render={
                <a
                  href={mailtoLink(
                    customer.profile.name,
                    customer.contactName,
                    customer.contactEmail,
                    link,
                  )}
                />
              }
            >
              <Mail className="size-4" />
              Open in mail app
            </Button>
          </div>
        </div>
        <Input readOnly value={subject} aria-label="Email subject" />
        <Textarea readOnly value={body} className="min-h-48" aria-label="Email body" />
      </div>

      <Separator />

      <div className="space-y-4">
        <h3 className="ta-headline-2">Contact</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="contactName" className="ta-label-1">
              Contact name
            </Label>
            <Input
              id="contactName"
              value={customer.contactName ?? ""}
              onChange={(event) => onChange({ contactName: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contactEmail" className="ta-label-1">
              Contact email
            </Label>
            <Input
              id="contactEmail"
              type="email"
              value={customer.contactEmail ?? ""}
              onChange={(event) => onChange({ contactEmail: event.target.value })}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="label" className="ta-label-1">
            Label
          </Label>
          <Input
            id="label"
            value={customer.label ?? ""}
            onChange={(event) => onChange({ label: event.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="notes" className="ta-label-1">
            Notes
          </Label>
          <Textarea
            id="notes"
            className="min-h-24"
            value={customer.notes ?? ""}
            onChange={(event) => onChange({ notes: event.target.value })}
          />
        </div>
      </div>
    </div>
  );
}
