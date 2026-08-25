import { useEffect, useState } from "react";
import { listAccounts } from "./api/backend";

// Who a mailbox address belongs to.
//
// Voicemail data carries an address; the person's name lives on their account. Several admin
// surfaces want to lead with the name, so the lookup is shared and the accounts are fetched ONCE
// per session rather than once per component — a cached promise, not a cached result, so
// components mounting at the same moment join the same request instead of racing it.

let pending: Promise<Map<string, string>> | null = null;

function loadNames(): Promise<Map<string, string>> {
  if (!pending) {
    pending = listAccounts()
      .then((accounts) => new Map(accounts.map((a) => [a.email, a.name])))
      .catch(() => {
        pending = null; // let a later mount retry rather than caching the failure
        return new Map<string, string>();
      });
  }
  return pending;
}

// Drop the cache when the session changes, so signing in as someone else doesn't inherit a list
// the new account may not even be allowed to see.
export function forgetAccountNames(): void {
  pending = null;
}

export function useAccountNames(): Map<string, string> {
  const [names, setNames] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let active = true;
    void loadNames().then((map) => active && setNames(map));
    return () => {
      active = false;
    };
  }, []);

  return names;
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
