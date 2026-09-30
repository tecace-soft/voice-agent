import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { CallSettings } from "../callSettings";

/**
 * What a call-settings section is handed by its container.
 *
 * `update` applies a change to the LATEST settings — not the ones this render saw — and saves the
 * result, one save at a time. Two switches flipped in quick succession would otherwise each send a
 * copy with only their own change, and the second would quietly undo the first. It throws on a
 * refusal; a thrown error with a `field` ("transfer.scenarios[2].numbers[0]") is shown under that
 * input. A business saves the draft and publishes separately; a demo saves straight into its record.
 */
export type CallSettingsBinding = {
  value: CallSettings;
  update: (change: (current: CallSettings) => CallSettings) => Promise<void>;
  mode: "business" | "demo";
  businessName: string;
  /** The number the assistant answers on — warm transfers ring from it. Null before one is assigned. */
  agentNumber: string | null;
  waterfallAllowed: boolean;
  /** Business only: the Publish bar, shared by the three sections. */
  publishBar?: ReactNode;
  /** Shown but not editable: a demo's own customer, before onboarding. */
  readOnly?: boolean;
};

/**
 * Serialise saves against a ref holding the latest value. Each change is applied to what the
 * previous save left (or failed to change), and the next waits for it.
 */
export function makeUpdater(
  latest: { current: CallSettings },
  persist: (next: CallSettings) => Promise<CallSettings>,
  queue: { current: Promise<unknown> },
): CallSettingsBinding["update"] {
  return (change) => {
    const run = queue.current
      .catch(() => undefined)
      .then(async () => {
        latest.current = await persist(change(latest.current));
      });
    queue.current = run;
    return run;
  };
}

/** An error that may say which field it is about. */
export type FieldError = { message: string; field?: string };

export function toFieldError(error: unknown, fallback: string): FieldError {
  if (error && typeof error === "object") {
    const e = error as { message?: unknown; field?: unknown };
    return {
      message: typeof e.message === "string" && e.message ? e.message : fallback,
      field: typeof e.field === "string" ? e.field : undefined,
    };
  }
  return { message: fallback };
}

/**
 * The part of a backend field path after a scenario's index, so a dialog editing scenario 2 can show
 * "numbers[0]" under the first number: `transfer.scenarios[2].numbers[0]` → `numbers[0]`.
 */
export function localField(field: string | undefined, prefix: string, index: number): string | undefined {
  const head = `${prefix}[${index}]`;
  if (!field?.startsWith(head)) return undefined;
  return field.slice(head.length).replace(/^\./, "") || "";
}

export function FieldMessage({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p className="ta-caption-1 text-destructive" role="alert">
      {children}
    </p>
  );
}

/** Pressing Publish: in flight, and why it failed — the one place for the failure's wording. */
export function usePublish(onPublish: () => Promise<void>) {
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function publish() {
    setPublishing(true);
    setError(null);
    try {
      await onPublish();
    } catch (e) {
      setError(toFieldError(e, "Couldn't publish. Nothing changed for callers.").message);
    } finally {
      setPublishing(false);
    }
  }

  return { publishing, error, publish };
}

/**
 * Unpublished changes, and the button that makes them live. Disabled when there is nothing new,
 * which is also the only feedback that a publish worked.
 */
export function PublishBar({
  dirty,
  publishedAt,
  onPublish,
}: {
  dirty: boolean;
  publishedAt: string | null;
  onPublish: () => Promise<void>;
}) {
  const { publishing, error, publish } = usePublish(onPublish);

  return (
    <div className="bg-muted/40 mb-6 flex flex-wrap items-center gap-3 rounded-xl border p-3">
      <div className="min-w-0 flex-1">
        <p className="ta-label-1">
          {dirty ? "You have changes callers don't get yet" : "Callers get what you see here"}
        </p>
        <p className="ta-caption-1 text-muted-foreground">
          {dirty
            ? "Transfers, links and message scenarios are saved as a draft. Test them in the app, then publish."
            : publishedAt
              ? `Published ${new Date(publishedAt).toLocaleString()}.`
              : "Nothing published yet."}
        </p>
        {error ? <FieldMessage>{error}</FieldMessage> : null}
      </div>
      <Button onClick={() => void publish()} disabled={!dirty || publishing}>
        {publishing ? "Publishing" : "Publish"}
      </Button>
    </div>
  );
}

/**
 * The Publish button and the state it acts on, compact enough for the settings bar. Callers keep the
 * published copy until it is pressed; the in-app test call uses the draft.
 */
export function PublishControl({
  dirty,
  publishedAt,
  onPublish,
}: {
  dirty: boolean;
  publishedAt: string | null;
  onPublish: () => Promise<void>;
}) {
  const { publishing, error, publish } = usePublish(onPublish);

  return (
    <div className="flex flex-wrap items-center gap-3">
      {error ? (
        <span className="ta-caption-1 text-destructive" role="alert">
          {error}
        </span>
      ) : (
        <span className="ta-caption-1 text-muted-foreground flex items-center gap-1.5">
          {dirty ? <span className="bg-warning size-1.5 rounded-full" aria-hidden /> : null}
          {dirty
            ? "Unpublished changes. Callers get the last published version; test calls use this draft."
            : publishedAt
              ? `Published ${new Date(publishedAt).toLocaleString()}`
              : "Not published yet"}
        </span>
      )}
      <Button size="sm" onClick={() => void publish()} disabled={!dirty || publishing}>
        {publishing ? "Publishing" : "Publish"}
      </Button>
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-8 text-center">
      <p className="ta-headline-2">{title}</p>
      <p className="ta-body-2 text-muted-foreground max-w-md">{children}</p>
      {action}
    </div>
  );
}

/**
 * A scenario's form, opened in place under its row (or at the top of the list for a new one) rather
 * than in a dialog, so the list stays in view while it is edited. Escape cancels.
 */
export function InlineEditor({
  title,
  description,
  onCancel,
  children,
}: {
  title: string;
  description?: string;
  onCancel: () => void;
  children: ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={title}
      className="bg-muted/30 border-t p-4 md:p-5"
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <p className="ta-label-1">{title}</p>
      {description ? <p className="ta-caption-1 text-muted-foreground">{description}</p> : null}
      <div className="mt-4 space-y-5">{children}</div>
    </div>
  );
}

/** A small coloured label for a row: a transfer's type, "Example", "Off". */
export function Tag({ tone = "muted", children }: { tone?: "muted" | "blue" | "amber" | "green"; children: ReactNode }) {
  const colour = {
    muted: "bg-muted text-muted-foreground",
    blue: "bg-primary/10 text-primary",
    amber: "bg-warning/15 text-warning",
    green: "bg-success/15 text-success",
  }[tone];
  return <span className={`ta-caption-2 inline-flex shrink-0 items-center rounded-md px-2 py-0.5 ${colour}`}>{children}</span>;
}

/**
 * One scenario in a list: the row opens its editor in place. The row's button covers the summary;
 * the switch and delete sit beside it, outside the button. `data-row` keeps the row visible when the
 * settings are read-only (see `.settings-readonly` in src/styles/index.css).
 */
export function ScenarioRow({
  open,
  onToggle,
  label,
  main,
  meta,
  actions,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  /** What the row's button is called for a screen reader: "Edit Billing". */
  label: string;
  main: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li>
      <div className={`flex items-center gap-2 pr-3 ${open ? "bg-muted/30" : "hover:bg-muted/30"}`}>
        <button
          type="button"
          data-row
          onClick={onToggle}
          aria-expanded={open}
          aria-label={label}
          className="flex min-w-0 flex-1 items-center gap-4 py-2.5 pl-4 text-left disabled:cursor-default"
        >
          <span className="min-w-0 flex-1">{main}</span>
          {meta ? <span className="hidden shrink-0 items-center gap-4 @2xl:flex">{meta}</span> : null}
        </button>
        {actions}
      </div>
      {open ? children : null}
    </li>
  );
}
