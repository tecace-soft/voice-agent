import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  DEFAULT_LINK_TEXT,
  MAX_LINK_TEXT,
  MAX_SCENARIOS,
  consentPreview,
  displayPhone,
  linkPreview,
  newId,
  urlProblem,
  type LinkScenario,
} from "../callSettings";
import { SectionIntro } from "../SettingsShell";
import {
  EmptyState,
  FieldMessage,
  localField,
  toFieldError,
  type CallSettingsBinding,
  type FieldError,
} from "./shared";

// Links the assistant can text a caller while they're on the phone — directions, a menu, a price
// list — and the consent rules those texts go out under.
//
// The assistant answers out loud first and offers the link after, and only texts once the caller
// says yes. With double opt-in on (the default), a number's first text asks for a YES before any
// link is sent; that is the business's protection as much as the caller's, which is why turning it
// off asks for confirmation.

function blankLink(): LinkScenario {
  return { id: newId(), enabled: true, triggers: [], text: DEFAULT_LINK_TEXT, url: "https://" };
}

export function TextLinkSection({ binding }: { binding: CallSettingsBinding }) {
  const links = binding.value.links.scenarios;
  const [editing, setEditing] = useState<{ link: LinkScenario; index: number } | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const change = (fn: (list: LinkScenario[]) => LinkScenario[]) =>
    binding.update((current) => ({ ...current, links: { scenarios: fn(current.links.scenarios) } }));

  async function run(action: () => Promise<void>, fallback: string) {
    setRowError(null);
    try {
      await action();
    } catch (e) {
      setRowError(toFieldError(e, fallback).message);
    }
  }

  async function setDoubleOptIn(on: boolean) {
    if (
      !on &&
      !window.confirm(
        "Turn off text consent?\n\nWithout it, links are sent without first asking the caller to reply YES. The business is responsible for any legal consequences of texting without consent.",
      )
    ) {
      return;
    }
    await run(
      () => binding.update((current) => ({ ...current, sms: { doubleOptIn: on } })),
      "Couldn't change that.",
    );
  }

  const full = links.length >= MAX_SCENARIOS;
  const add = () => setEditing({ link: blankLink(), index: -1 });

  return (
    <div>
      {binding.publishBar}
      <SectionIntro>
        Text a caller a link while you're on the phone with them — directions, your menu, a price list,
        online ordering. The assistant answers out loud first, then offers the link, and only sends it if
        the caller says yes. Texts go to US mobile numbers only.
      </SectionIntro>

      {rowError ? <FieldMessage>{rowError}</FieldMessage> : null}

      {links.length === 0 ? (
        <EmptyState
          title="No link scenarios yet"
          action={
            <Button onClick={add}>
              <Plus className="size-4" />
              Add a link
            </Button>
          }
        >
          Add a scenario so the assistant knows when to offer a link.
        </EmptyState>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When a caller asks about</TableHead>
                <TableHead>Link</TableHead>
                <TableHead className="text-right">On</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {links.map((link, index) => (
                <TableRow key={link.id}>
                  <TableCell className="ta-label-1">{link.triggers.join(", ")}</TableCell>
                  <TableCell className="ta-caption-1 max-w-xs truncate">{link.url}</TableCell>
                  <TableCell className="text-right">
                    <Switch
                      checked={link.enabled}
                      aria-label={`Turn the ${link.triggers[0] ?? "link"} link ${link.enabled ? "off" : "on"}`}
                      onCheckedChange={(enabled) =>
                        void run(
                          () => change((list) => list.map((l) => (l.id === link.id ? { ...l, enabled } : l))),
                          "Couldn't change that.",
                        )
                      }
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon-sm" aria-label="Edit link" onClick={() => setEditing({ link, index })}>
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Delete link"
                      onClick={() =>
                        window.confirm("Delete this link scenario?") &&
                        void run(() => change((list) => list.filter((l) => l.id !== link.id)), "Couldn't delete that.")
                      }
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="mt-4 flex items-center gap-3">
            <Button variant="outline" disabled={full} onClick={add}>
              <Plus className="size-4" />
              Add a link
            </Button>
            <span className="ta-caption-1 text-muted-foreground">
              {links.length} of {MAX_SCENARIOS}
            </span>
          </div>
        </>
      )}

      <div className="mt-8 rounded-xl border p-4">
        <label className="flex items-start justify-between gap-4">
          <span>
            <span className="ta-headline-2 block">Text consent (double opt-in)</span>
            <span className="ta-caption-1 text-muted-foreground block max-w-xl">
              The first time a number would get a text from you, it gets this instead. The link follows
              once they reply YES. Anyone who replies STOP is never texted again.
            </span>
          </span>
          <Switch
            checked={binding.value.sms.doubleOptIn}
            onCheckedChange={(on) => void setDoubleOptIn(on)}
            aria-label="Ask for consent before the first text"
          />
        </label>
        <div className="bg-muted/50 ta-body-2 mt-4 max-w-md rounded-2xl p-3">
          {consentPreview(
            binding.businessName,
            binding.agentNumber ? displayPhone(binding.agentNumber) : null,
          )}
        </div>
      </div>

      {editing ? (
        <LinkDialog
          initial={editing.link}
          index={editing.index === -1 ? links.length : editing.index}
          businessName={binding.businessName}
          onCancel={() => setEditing(null)}
          onSave={async (link) => {
            await change((list) =>
              list.some((l) => l.id === link.id) ? list.map((l) => (l.id === link.id ? link : l)) : [...list, link],
            );
            setEditing(null);
          }}
        />
      ) : null}
    </div>
  );
}

function LinkDialog({
  initial,
  index,
  businessName,
  onCancel,
  onSave,
}: {
  initial: LinkScenario;
  index: number;
  businessName: string;
  onCancel: () => void;
  onSave: (link: LinkScenario) => Promise<void>;
}) {
  const [draft, setDraft] = useState(initial);
  const [triggers, setTriggers] = useState(initial.triggers.join(", "));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<FieldError | null>(null);
  const [tried, setTried] = useState(false);

  const where = error ? localField(error.field, "links.scenarios", index) : undefined;
  const words = triggers.split(",").map((t) => t.trim()).filter(Boolean);
  const problems = {
    triggers: words.length ? null : "Add at least one keyword, like directions or menu.",
    text: draft.text.length > MAX_LINK_TEXT ? `Keep it to ${MAX_LINK_TEXT} characters.` : null,
    url: urlProblem(draft.url),
  };

  async function submit() {
    setTried(true);
    if (problems.triggers || problems.text || problems.url) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({ ...draft, triggers: words, url: draft.url.trim() });
    } catch (e) {
      setError(toFieldError(e, "Couldn't save this link."));
    } finally {
      setSaving(false);
    }
  }

  const show = (field: "triggers" | "text" | "url") =>
    (where?.startsWith(field) ? error?.message : null) ?? (tried ? problems[field] : null);

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="rounded-[20px] sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{initial.triggers.length ? "Edit link" : "Add a link"}</DialogTitle>
          <DialogDescription>When to offer it, and the text it arrives in.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="link-triggers" className="ta-label-1">
              When a caller asks about
            </Label>
            <Input
              id="link-triggers"
              value={triggers}
              placeholder="directions, where you are, parking"
              onChange={(e) => setTriggers(e.target.value)}
            />
            <p className="ta-caption-1 text-muted-foreground">Keywords or phrases, separated by commas.</p>
            <FieldMessage>{show("triggers")}</FieldMessage>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="link-text" className="ta-label-1">
              Text message
            </Label>
            <Textarea id="link-text" value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
            <p className="ta-caption-1 text-muted-foreground">
              {draft.text.length} of {MAX_LINK_TEXT}. Write [business_name] and we fill it in — include it so
              people know who texted them.
            </p>
            <FieldMessage>{show("text")}</FieldMessage>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="link-url" className="ta-label-1">
              Link
            </Label>
            <Input id="link-url" value={draft.url} inputMode="url" onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
            <FieldMessage>{show("url")}</FieldMessage>
          </div>
          {!problems.url ? (
            <div>
              <p className="ta-caption-1 text-muted-foreground mb-1">What the caller receives</p>
              <div className="bg-muted/50 ta-body-2 max-w-md rounded-2xl p-3 break-words">
                {linkPreview(draft.text, draft.url.trim(), businessName)}
              </div>
            </div>
          ) : null}
          <label className="ta-label-1 flex items-center justify-between gap-4 rounded-lg border p-3">
            On
            <Switch checked={draft.enabled} onCheckedChange={(enabled) => setDraft({ ...draft, enabled })} />
          </label>
          {error && where === undefined ? <FieldMessage>{error.message}</FieldMessage> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving ? "Saving" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
