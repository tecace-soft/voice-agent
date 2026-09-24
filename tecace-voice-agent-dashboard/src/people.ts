import { useEffect, useMemo, useState } from "react";
import { listAccounts } from "./api/backend";
import type { Role } from "./api/types";

// Who a mailbox address belongs to.
//
// Voicemail data carries an address; the person's name lives on their account. Several admin
// surfaces want to lead with the name, so the lookup is shared and the accounts are fetched ONCE
// per session rather than once per component — a cached promise, not a cached result, so
// components mounting at the same moment join the same request instead of racing it.

export interface AccountInfo {
  name: string;
  role: Role;
}

let pending: Promise<Map<string, AccountInfo>> | null = null;

function loadAccounts(): Promise<Map<string, AccountInfo>> {
  if (!pending) {
    pending = listAccounts()
      .then((accounts) => new Map(accounts.map((a) => [a.email, { name: a.name, role: a.role }])))
      .catch(() => {
        pending = null; // let a later mount retry rather than caching the failure
        return new Map<string, AccountInfo>();
      });
  }
  return pending;
}

// Drop the cache when the session changes, so signing in as someone else doesn't inherit a list
// the new account may not even be allowed to see.
export function forgetAccountNames(): void {
  pending = null;
}

// email -> { name, role }. Everything below derives from this one cached fetch.
// `enabled` is false where the caller is not an admin. The accounts list is an admin endpoint, so
// asking as anybody else is a guaranteed 403 — harmless, since the failure is caught and the name
// falls back to the address, but it is a refused request on every page load, and a customer's browser
// asking for the list of everyone's accounts is not something to leave lying in a log.
export function useAccounts(enabled = true): Map<string, AccountInfo> {
  const [accounts, setAccounts] = useState<Map<string, AccountInfo>>(new Map());

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void loadAccounts().then((map) => active && setAccounts(map));
    return () => {
      active = false;
    };
  }, [enabled]);

  return accounts;
}

// Just the names, for the places that only display who a mailbox belongs to.
export function useAccountNames(enabled = true): Map<string, string> {
  const accounts = useAccounts(enabled);
  return useMemo(
    () => new Map([...accounts].map(([email, info]) => [email, info.name])),
    [accounts],
  );
}

// How a mailbox reads when we lead with the person: their name if we know it, otherwise the address
// itself — never a blank where a name would be.
export function displayName(email: string | null, names: Map<string, string>): string {
  if (email === null) return "Unattributed";
  return names.get(email) ?? email;
}

// The quieter second line. Empty when the primary line is already the address, so it isn't printed
// twice.
export function displaySubtitle(email: string | null, names: Map<string, string>): string {
  if (email === null) return "runs with no mailbox recorded";
  return names.has(email) ? email : "";
}
