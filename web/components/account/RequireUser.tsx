"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import type { User } from "@supabase/supabase-js";

/** Nur für Angemeldete; sonst weiter zur Anmeldung (und danach zurück). */
export function RequireUser({ children }: { children: (user: User) => ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    if (!loading && !user) router.replace(`/login?next=${encodeURIComponent(path)}`);
  }, [loading, user, router, path]);
  if (!user) return <p className="py-10 text-slate">Loading…</p>;
  return <>{children(user)}</>;
}
