import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  BackendError,
  fetchMe,
  getSetupState,
  getToken,
  login as apiLogin,
  logout as apiLogout,
  setupFirstAccount,
  setUnauthorizedHandler,
} from "./api/backend";
import type { AuthUser } from "./api/types";

type Status = "loading" | "signed-out" | "signed-in";

interface AuthValue {
  status: Status;
  user: AuthUser | null;
  // True while the database has no accounts at all. Sign-in is still the first screen either way —
  // this only decides whether it offers a way through to creating the first account.
  needsSetup: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  createFirstAccount: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

// Holds the session for the whole app: restores it from the stored token on boot, decides whether
// this deployment still needs its first account, and drops back to the sign-in screen whenever the
// backend rejects that token.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    // The API layer calls this when any request comes back 401 — an expired token, or one revoked
    // while the tab was open.
    setUnauthorizedHandler(() => {
      setUser(null);
      setStatus("signed-out");
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    let active = true;

    // Always land on sign-in; the setup-state answer only decides whether that screen offers a link
    // to create the first account. If the backend can't be reached we still show sign-in, where the
    // error is actionable.
    const decideSignedOutState = () =>
      getSetupState()
        .then((state) => {
          if (!active) return;
          setNeedsSetup(state.needsSetup);
          setStatus("signed-out");
        })
        .catch(() => {
          if (active) setStatus("signed-out");
        });

    if (!getToken()) {
      void decideSignedOutState();
      return () => {
        active = false;
      };
    }

    fetchMe()
      .then((me) => {
        if (!active) return;
        setUser(me);
        setStatus("signed-in");
      })
      .catch(() => void decideSignedOutState());

    return () => {
      active = false;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { user: signedIn } = await apiLogin(email, password);
    setUser(signedIn);
    setStatus("signed-in");
  }, []);

  const createFirstAccount = useCallback(async (name: string, email: string, password: string) => {
    const { user: created } = await setupFirstAccount(name, email, password);
    setUser(created);
    setNeedsSetup(false);
    setStatus("signed-in");
  }, []);

  const signOut = useCallback(async () => {
    await apiLogout();
    setUser(null);
    setStatus("signed-out");
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ status, user, needsSetup, signIn, createFirstAccount, signOut }),
    [status, user, needsSetup, signIn, createFirstAccount, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}

// Turn a failed sign-in into something worth showing the person typing.
export function signInErrorMessage(error: unknown): string {
  if (error instanceof BackendError) {
    if (error.status === 0) return error.message; // unreachable / unconfigured backend
    if (error.status === 401) return "Incorrect email or password.";
    return error.message;
  }
  return "Something went wrong signing in. Try again.";
}

// Same idea for the account forms, where the backend's own message (email taken, weak password,
// setup already done) is the useful one.
export function accountErrorMessage(error: unknown, fallback = "Something went wrong. Try again."): string {
  if (error instanceof BackendError) return error.message || fallback;
  return fallback;
}
