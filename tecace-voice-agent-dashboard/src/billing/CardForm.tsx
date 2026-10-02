import { CreditCard, Lock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CardInput } from "../api/types";

// The card form, in TEST MODE: it looks and behaves like the one Stripe Elements will replace it
// with (ax-billing), but the number only ever reaches our own backend, which checks it like a card
// form does and keeps the brand, the last four and the expiry — never the number or the code. The
// page says so, so nobody types a real card thinking it is being charged.

export type CardFormValue = { number: string; expiry: string; cvc: string; name: string };

export const EMPTY_CARD: CardFormValue = { number: "", expiry: "", cvc: "", name: "" };

/** Which field the backend refused, as `BackendError.field` names it. */
export type CardField = "number" | "expiry" | "cvc";

/** The form's value as the backend takes it, or the field that is not filled in properly. */
export function cardInputFrom(value: CardFormValue): { card: CardInput } | { field: CardField; message: string } {
  const digits = value.number.replace(/[\s-]/g, "");
  if (!/^\d{12,19}$/.test(digits)) return { field: "number", message: "Enter the card number." };
  const match = /^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/.exec(value.expiry.trim());
  if (!match) return { field: "expiry", message: "Expiry is MM/YY." };
  const expMonth = Number(match[1]);
  const expYear = Number(match[2]);
  if (expMonth < 1 || expMonth > 12) return { field: "expiry", message: "Expiry is MM/YY." };
  if (!/^\d{3,4}$/.test(value.cvc.trim())) return { field: "cvc", message: "The security code is 3 or 4 digits." };
  return { card: { number: digits, expMonth, expYear, cvc: value.cvc.trim(), name: value.name.trim() || undefined } };
}

/** 4242424242424242 → 4242 4242 4242 4242, as the person types. */
function groupDigits(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 19).replace(/(\d{4})(?=\d)/g, "$1 ");
}

function groupExpiry(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
}

export function CardForm({
  value,
  onChange,
  error,
  disabled,
  idPrefix = "card",
}: {
  value: CardFormValue;
  onChange: (next: CardFormValue) => void;
  /** The field the backend (or `cardInputFrom`) refused, and why. */
  error?: { field?: string; message: string } | null;
  disabled?: boolean;
  idPrefix?: string;
}) {
  const set = (patch: Partial<CardFormValue>) => onChange({ ...value, ...patch });
  const bad = (field: CardField) => (error?.field === field ? error.message : null);
  const id = (field: string) => `${idPrefix}-${field}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="bg-warning/10 text-warning ta-caption-1 flex items-center gap-2 rounded-lg px-3 py-2">
        <Lock className="size-3.5 shrink-0" aria-hidden />
        <span>
          <b className="font-semibold">Test mode.</b> Payments aren&apos;t switched on yet: use a test card such as 4242 4242
          4242 4242. Nothing is charged.
        </span>
      </div>
      <Field id={id("number")} label="Card number" error={bad("number")}>
        <div className="relative">
          <CreditCard className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" aria-hidden />
          <Input
            id={id("number")}
            className="h-10 pl-9 font-mono"
            inputMode="numeric"
            autoComplete="cc-number"
            placeholder="4242 4242 4242 4242"
            value={value.number}
            disabled={disabled}
            aria-invalid={bad("number") ? true : undefined}
            onChange={(e) => set({ number: groupDigits(e.target.value) })}
          />
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field id={id("expiry")} label="Expiry" error={bad("expiry")}>
          <Input
            id={id("expiry")}
            className="h-10 font-mono"
            inputMode="numeric"
            autoComplete="cc-exp"
            placeholder="MM/YY"
            value={value.expiry}
            disabled={disabled}
            aria-invalid={bad("expiry") ? true : undefined}
            onChange={(e) => set({ expiry: groupExpiry(e.target.value) })}
          />
        </Field>
        <Field id={id("cvc")} label="Security code" error={bad("cvc")}>
          <Input
            id={id("cvc")}
            className="h-10 font-mono"
            inputMode="numeric"
            autoComplete="cc-csc"
            placeholder="123"
            maxLength={4}
            value={value.cvc}
            disabled={disabled}
            aria-invalid={bad("cvc") ? true : undefined}
            onChange={(e) => set({ cvc: e.target.value.replace(/\D/g, "") })}
          />
        </Field>
      </div>
      <Field id={id("name")} label="Name on card">
        <Input
          id={id("name")}
          className="h-10"
          autoComplete="cc-name"
          value={value.name}
          disabled={disabled}
          onChange={(e) => set({ name: e.target.value })}
        />
      </Field>
    </div>
  );
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string | null; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="ta-label-1">
        {label}
      </Label>
      {children}
      {error ? (
        <p className="ta-caption-1 text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
