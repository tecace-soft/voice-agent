import { demoFetch } from "@/api";
import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { readJson } from "@/lib/http";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

// Dashboard-only (see PORTING.md): the promo's NewCustomerDialog with two required fields and the
// rest folded away. One link field takes either the website or the Google Maps link; the backend
// gets it under the key it wants. One button: whether research runs now is a checkbox, not a
// second button.

const EMPTY = {
  businessName: "",
  link: "",
  researchNotes: "",
  label: "",
  contactName: "",
  contactEmail: "",
  agentName: "Alex",
};

/** The backend's own rule (`demo/maps.ts`): a Google host, or one of Google's short-link hosts. */
export function looksLikeMapsLink(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.replace(/^www\./, "");
    return ["maps.app.goo.gl", "goo.gl", "g.co"].includes(host) || host.endsWith("google.com") || host.startsWith("maps.google.");
  } catch {
    return false;
  }
}

/** "harbordental.com" is a website; the backend wants a scheme on it. */
function withScheme(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || /^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function NewProspectDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [research, setResearch] = useState(true);
  const [form, setForm] = useState(EMPTY);

  function update(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const link = withScheme(form.link);
    const { link: _link, ...rest } = form;
    void _link;
    const body = {
      ...rest,
      ...(link ? (looksLikeMapsLink(link) ? { mapsUrl: link } : { websiteUrl: link }) : {}),
      research,
    };
    try {
      const response = await demoFetch("/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      await readJson<{ customer: unknown }>(response);
      toast.success(research ? "Prospect added. Research is running." : "Prospect added. Run research from its page when you're ready.");
      setOpen(false);
      setForm(EMPTY);
      setResearch(true);
      onCreated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add the prospect.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button>
            <Plus className="size-4" />
            New prospect
          </Button>
        }
      />
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="ta-headline-1">New prospect</DialogTitle>
          <DialogDescription className="ta-body-2">
            We research the business and build its receptionist, about two minutes.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="businessName" className="ta-label-1">
              Business name
            </Label>
            <Input
              id="businessName"
              placeholder="Harbor Dental"
              value={form.businessName}
              onChange={(event) => update("businessName", event.target.value)}
              aria-invalid={error ? /business name/i.test(error) : undefined}
              required
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="link" className="ta-label-1">
              Website or Google Maps link
            </Label>
            <Input
              id="link"
              placeholder="harbordental.com"
              value={form.link}
              onChange={(event) => update("link", event.target.value)}
              aria-invalid={error ? /website|maps/i.test(error) : undefined}
            />
            <p className="ta-caption-1 text-muted-foreground">Helps the research pick the right business.</p>
          </div>
          <details className="group">
            <summary className="ta-label-1 text-primary cursor-pointer list-none select-none">
              Contact and more <span className="text-muted-foreground">(optional)</span>
            </summary>
            <div className="mt-3 space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="contactName" className="ta-label-1">
                    Contact name
                  </Label>
                  <Input id="contactName" value={form.contactName} onChange={(event) => update("contactName", event.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="contactEmail" className="ta-label-1">
                    Contact email
                  </Label>
                  <Input id="contactEmail" type="email" value={form.contactEmail} onChange={(event) => update("contactEmail", event.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="agentName" className="ta-label-1">
                    Receptionist name
                  </Label>
                  <Input id="agentName" value={form.agentName} onChange={(event) => update("agentName", event.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="label" className="ta-label-1">
                    Label
                  </Label>
                  <Input id="label" placeholder="Met at the expo" value={form.label} onChange={(event) => update("label", event.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="researchNotes" className="ta-label-1">
                  Notes for the research
                </Label>
                <Textarea
                  id="researchNotes"
                  className="min-h-16"
                  placeholder="Which branch, who answers the phone, what to emphasise."
                  value={form.researchNotes}
                  onChange={(event) => update("researchNotes", event.target.value)}
                />
              </div>
            </div>
          </details>
          <label className="ta-label-1 flex items-center gap-2">
            <input
              type="checkbox"
              className="accent-primary size-4"
              checked={research}
              onChange={(event) => setResearch(event.target.checked)}
            />
            Research it now
            <span className="ta-caption-1 text-muted-foreground">(a billed run)</span>
          </label>
          {error ? (
            <p className="ta-caption-1 text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !form.businessName.trim()}>
              {busy ? "Adding" : "Add prospect"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
