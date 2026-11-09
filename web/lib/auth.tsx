"use client";

// Anmeldung (Supabase Auth): wer ist eingeloggt? Ohne eingerichtete Konten ist immer niemand angemeldet.
import type { User } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { accountsEnabled } from "./supabase/config";
import { supabaseBrowser } from "./supabase/client";

interface Auth {
  enabled: boolean;
  user: User | null;
  /** true, bis feststeht, ob jemand angemeldet ist */
  loading: boolean;
}

const Ctx = createContext<Auth>({ enabled: false, user: null, loading: false });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(accountsEnabled);

  useEffect(() => {
    const sb = supabaseBrowser();
    if (!sb) return;
    sb.auth.getUser().then(({ data }) => {
      setUser(data.user ?? null);
      setLoading(false);
    });
    const { data } = sb.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  return <Ctx.Provider value={{ enabled: accountsEnabled, user, loading }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);

/** Fehlermeldungen von Supabase in verständliche Sätze übersetzen (Website ist englisch). */
export function authMessage(err: { message?: string; code?: string } | null | undefined): string {
  const m = `${err?.code ?? ""} ${err?.message ?? ""}`.toLowerCase();
  if (m.includes("invalid_credentials") || m.includes("invalid login")) return "Email or password is wrong.";
  if (m.includes("email_not_confirmed") || m.includes("not confirmed"))
    return "Please confirm your email first – check your inbox for the link.";
  if (m.includes("user_already_exists") || m.includes("already registered")) return "There is already an account with this email.";
  if (m.includes("weak_password") || m.includes("password should")) return "Please choose a stronger password.";
  if (m.includes("same_password")) return "The new password must be different from the old one.";
  if (m.includes("rate") || m.includes("too many") || m.includes("over_email_send"))
    return "Too many attempts. Please wait a few minutes and try again.";
  if (m.includes("fetch") || m.includes("network")) return "No connection. Please try again.";
  return err?.message || "Something went wrong. Please try again.";
}
