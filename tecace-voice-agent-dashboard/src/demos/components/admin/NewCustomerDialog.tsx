
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

export function NewCustomerDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    businessName: "",
    websiteUrl: "",
    mapsUrl: "",
    researchNotes: "",
    label: "",
    contactName: "",
    contactEmail: "",
    agentName: "Alex",
  });

  function update(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await demoFetch("/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      await readJson<{ customer: unknown }>(response);
      toast.success("Customer added. Research is running.");
      setOpen(false);
      setForm({
        businessName: "",
        websiteUrl: "",
        mapsUrl: "",
        researchNotes: "",
        label: "",
        contactName: "",
        contactEmail: "",
        agentName: "Alex",
      });
      onCreated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add the customer.");
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
            New customer
          </Button>
        }
      />
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="ta-headline-1">New customer</DialogTitle>
          <DialogDescription className="ta-caption-1">
            The business name is what gets researched. A website or a Google Maps link
            just helps pick the right one.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="businessName" className="ta-label-1">
              Business name
            </Label>
            <Input
              id="businessName"
              placeholder="Joe's Pizza, Carmine St"
              value={form.businessName}
              onChange={(event) => update("businessName", event.target.value)}
              // Only the name's own complaint marks the name. A storage or
              // network failure has nothing to do with what was typed here.
              aria-invalid={error ? /business name/i.test(error) : undefined}
              required
              autoFocus
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="websiteUrl" className="ta-label-1">
                Website
              </Label>
              <Input
                id="websiteUrl"
                placeholder="https://example.com"
                value={form.websiteUrl}
                onChange={(event) => update("websiteUrl", event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mapsUrl" className="ta-label-1">
                Google Maps link
              </Label>
              <Input
                id="mapsUrl"
                placeholder="https://maps.app.goo.gl/..."
                value={form.mapsUrl}
                onChange={(event) => update("mapsUrl", event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="researchNotes" className="ta-label-1">
              Notes for the research
            </Label>
            <Textarea
              id="researchNotes"
              className="min-h-20"
              placeholder="Anything the web will not say: which branch, who answers the phone, what to emphasize."
              value={form.researchNotes}
              onChange={(event) => update("researchNotes", event.target.value)}
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="contactName" className="ta-label-1">
                Contact name
              </Label>
              <Input
                id="contactName"
                value={form.contactName}
                onChange={(event) => update("contactName", event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contactEmail" className="ta-label-1">
                Contact email
              </Label>
              <Input
                id="contactEmail"
                type="email"
                value={form.contactEmail}
                onChange={(event) => update("contactEmail", event.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="agentName" className="ta-label-1">
                Receptionist name
              </Label>
              <Input
                id="agentName"
                value={form.agentName}
                onChange={(event) => update("agentName", event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="label" className="ta-label-1">
                Label
              </Label>
              <Input
                id="label"
                placeholder="Optional note"
                value={form.label}
                onChange={(event) => update("label", event.target.value)}
              />
            </div>
          </div>
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
              {busy ? "Adding" : "Add customer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
