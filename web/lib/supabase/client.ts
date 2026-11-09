"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL, accountsEnabled } from "./config";

let client: SupabaseClient | null = null;

/** Ein Supabase-Client für den Browser (Sitzung in Cookies), oder null, wenn Konten nicht eingerichtet sind. */
export function supabaseBrowser(): SupabaseClient | null {
  if (!accountsEnabled) return null;
  client ??= createBrowserClient(SUPABASE_URL, SUPABASE_KEY);
  return client;
}
