import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { probePromo, PromoError, setPromoLockedHandler, unlockPromo } from "./api";

// Whether the demos can be used, separately from the dashboard sign-in: the promo still has its
// own admin password until its backend moves into transcribe-backend.
//
// `idle` until a Demos view asks — the probe runs on the first visit, never on a dashboard load,
// so someone who only uses the transcribe screens never probes the promo at all. (Its cookie is
// still cleared on every sign-out regardless — see App's wasSignedIn effect — but a DELETE never
// needs a probe first.)
export type PromoState = "idle" | "checking" | "locked" | "unlocked" | "unreachable";

interface PromoAuthValue {
  state: PromoState;
  /** Ask the promo again (first visit, or "Try again" after it was unreachable). */
  recheck: () => void;
  /** Throws a PromoError on a wrong password, a cookie that didn't stick, or an unreachable promo. */
  unlock: (password: string) => Promise<void>;
}

const PromoAuthContext = createContext<PromoAuthValue | null>(null);

export function PromoAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PromoState>("idle");
  // StrictMode runs DemosGate's "probe on first visit" effect twice in dev, which would fire two
  // overlapping probes — `probing` makes the second a no-op, and `probeSeq` makes sure that if two
  // ever do run (or a recheck races the probe inside unlock below), only the most recently started
  // one's result is ever applied.
  const probing = useRef(false);
  const probeSeq = useRef(0);

  const recheck = useCallback(() => {
    if (probing.current) return;
    probing.current = true;
    const seq = ++probeSeq.current;
    setState("checking");
    void probePromo().then((result) => {
      probing.current = false;
      if (seq === probeSeq.current) setState(result);
    });
  }, []);

  const unlock = useCallback(async (password: string) => {
    await unlockPromo(password);
    // A 200 from /admin/login only proves the promo accepted the password — not that this browser
    // then kept the Set-Cookie it sent back (third-party-cookie blocking, or the cookie's `Secure`
    // flag on a non-https origin, both drop it silently). Probe again and trust that, not the login
    // response, so a cookie that didn't stick shows up as an error instead of a dead "unlocked".
    const seq = ++probeSeq.current;
    const result = await probePromo();
    if (seq !== probeSeq.current) return;
    if (result === "locked") {
      throw new PromoError(
        "locked",
        "The promo accepted the password, but this browser didn't keep its sign-in cookie. Open the dashboard over https or on localhost.",
        401,
      );
    }
    setState(result);
  }, []);

  // Any promo call that comes back 401 (the cookie expired mid-session) locks the demos again.
  useEffect(() => {
    setPromoLockedHandler(() => setState("locked"));
    return () => setPromoLockedHandler(null);
  }, []);

  const value = useMemo(() => ({ state, recheck, unlock }), [state, recheck, unlock]);
  return <PromoAuthContext.Provider value={value}>{children}</PromoAuthContext.Provider>;
}

export function usePromoAuth(): PromoAuthValue {
  const value = useContext(PromoAuthContext);
  if (!value) throw new Error("usePromoAuth must be used inside <PromoAuthProvider>");
  return value;
}
