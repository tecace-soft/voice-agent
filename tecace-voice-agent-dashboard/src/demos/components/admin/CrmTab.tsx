
import { demoFetch } from "@/api";
import { useState } from "react";

import { toast } from "sonner";
import { readJson } from "@/lib/http";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/admin/shared";
import {
  ENTRY_ICON,
  FOLLOW_UP_ICON,
  STAGE_KIND,
  STAGE_LABEL,
  toDateValue,
} from "@/components/admin/crm-shared";
import { timeline } from "@/lib/analytics";
import { CUSTOMER_STAGES } from "@/lib/types";
import type {
  CallLog,
  CrmNote,
  Customer,
  CustomerStage,
  TrackEvent,
} from "@/lib/types";

export function CrmTab({
  customer,
  notes,
  events,
  calls,
  onChange,
  onNoteAdded,
  onOpenCall,
}: {
  customer: Customer;
  notes: CrmNote[];
  events: TrackEvent[];
  calls: CallLog[];
  onChange: (partial: Partial<Customer>) => void;
  onNoteAdded: () => void;
  onOpenCall?: (callId: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const stage = customer.stage ?? "new";
  const entries = timeline(notes, events, calls);

  async function addNote() {
    const text = draft.trim();
    if (!text) return;
    setSaving(true);
    try {
      const response = await demoFetch(`/customers/${customer.id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      await readJson<{ note: CrmNote }>(response);
      setDraft("");
      onNoteAdded();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not save the note.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="crm-stage" className="ta-label-1">
            Stage
          </Label>
          <Select
            value={stage}
            onValueChange={(value) =>
              onChange({ stage: (value as CustomerStage) ?? "new" })
            }
          >
            <SelectTrigger id="crm-stage" aria-label="Deal stage">
              <SelectValue>{STAGE_LABEL[stage]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {CUSTOMER_STAGES.map((value) => (
                <SelectItem key={value} value={value}>
                  {STAGE_LABEL[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="ta-caption-1 text-muted-foreground">
            Yours to set. Nothing moves it on its own.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="crm-contacted" className="ta-label-1">
            Last contacted
          </Label>
          <Input
            id="crm-contacted"
            type="date"
            value={toDateValue(customer.lastContactedAt)}
            onChange={(event) =>
              onChange({ lastContactedAt: event.target.value || undefined })
            }
          />
          <p className="ta-caption-1 text-muted-foreground">
            Set for you when you copy the email.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="crm-followup" className="ta-label-1">
            Follow up on
          </Label>
          <Input
            id="crm-followup"
            type="date"
            value={toDateValue(customer.followUpAt)}
            onChange={(event) =>
              onChange({ followUpAt: event.target.value || undefined })
            }
          />
          <p className="ta-caption-1 text-muted-foreground">
            Puts them in Due now at the top of the CRM board.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge kind={STAGE_KIND[stage]}>{STAGE_LABEL[stage]}</StatusBadge>
        {customer.followUpAt ? (
          <span className="ta-caption-1 text-muted-foreground flex items-center gap-1.5">
            <FOLLOW_UP_ICON className="size-3.5" aria-hidden />
            Follow up {new Date(customer.followUpAt).toLocaleDateString()}
          </span>
        ) : null}
      </div>

      <Separator />

      <div className="space-y-2">
        <Label htmlFor="crm-note" className="ta-label-1">
          Add a note
        </Label>
        <Textarea
          id="crm-note"
          className="min-h-20"
          placeholder="What they said, what they want, what to do next."
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <div className="flex justify-end">
          <Button onClick={() => void addNote()} disabled={saving || !draft.trim()}>
            {saving ? "Saving" : "Add note"}
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="ta-headline-2">Timeline</h3>
        {entries.length === 0 ? (
          <p className="ta-caption-1 text-muted-foreground">
            Nothing yet. Send the link, and what they do with it lands here.
          </p>
        ) : (
          <ul className="space-y-3">
            {entries.map((entry, index) => {
              const Icon = ENTRY_ICON[entry.kind];
              const row = (
                <>
                  <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
                  <span className="flex-1">
                    <span className="ta-body-2 block">{entry.text}</span>
                    <span className="ta-caption-2 text-muted-foreground">
                      {new Date(entry.at).toLocaleString()}
                    </span>
                  </span>
                </>
              );
              return (
                <li key={`${entry.kind}-${entry.at}-${index}`}>
                  {entry.callId && onOpenCall ? (
                    <button
                      type="button"
                      onClick={() => onOpenCall(entry.callId!)}
                      className="hover:bg-accent flex w-full gap-3 rounded-lg px-2 py-1.5 text-left"
                    >
                      {row}
                    </button>
                  ) : (
                    <span className="flex gap-3 px-2 py-1.5">{row}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
