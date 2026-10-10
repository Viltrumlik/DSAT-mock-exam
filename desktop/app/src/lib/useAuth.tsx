/**
 * The native app's auth state machine.
 *
 *   loading     — deciding whether a stored session is still good
 *   signedout   — show the sign-in screen
 *   connecting  — "Sign in with browser" is open; waiting for the code to come back
 *   signedin    — show "Your tests"
 *
 * Importers: App.tsx (routing), screens/SignIn.tsx (signIn + state), screens/YourTests.tsx (signOut).
 */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import { exchange, hasSession, onAuthLost, signOut as apiSignOut } from "./api";
import { native } from "./native";

export type AuthStatus = "loading" | "signedout" | "connecting" | "signedin";

interface AuthContextValue {
  status: AuthStatus;
  error: string | null;
  signIn: () => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [error, setError] = useState<string | null>(null);

  // Boot: is there a session already?
  useEffect(() => {
    let alive = true;
    void hasSession()
      .then((ok) => {
        if (alive) setStatus(ok ? "signedin" : "signedout");
      })
      .catch(() => {
        if (alive) setStatus("signedout");
      });
    return () => {
      alive = false;
    };
  }, []);

  // A refresh failed mid-use → the session is gone; return to sign-in.
  useEffect(() => {
    onAuthLost(() => {
      setError("Your session ended. Please sign in again.");
      setStatus("signedout");
    });
  }, []);

  // The browser handed a sign-in code back → redeem it for tokens.
  const busyRef = useRef(false);
  useEffect(() => {
    return native.onAuthCode(async (code) => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        const verifier = await native.authTakeVerifier();
        if (!verifier) throw new Error("This sign-in didn't start in the app. Please try again.");
        await exchange(code, verifier);
        setError(null);
        setStatus("signedin");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Sign-in failed. Please try again.");
        setStatus("signedout");
      } finally {
        busyRef.current = false;
      }
    });
  }, []);

  const signIn = () => {
    setError(null);
    setStatus("connecting");
    void native.authBegin().catch(() => {
      setError("Couldn't open your browser. Please try again.");
      setStatus("signedout");
    });
  };

  const signOut = () => {
    apiSignOut();
    setError(null);
    setStatus("signedout");
  };

  return <AuthContext.Provider value={{ status, error, signIn, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
