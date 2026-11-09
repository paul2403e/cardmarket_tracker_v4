// Ziel der Links aus den Supabase-Mails (Registrierung bestätigen, Passwort zurücksetzen).
// Tauscht den Code gegen eine Sitzung. Klappt das nicht (z. B. Link in einem anderen Browser geöffnet),
// ist die E-Mail trotzdem bestätigt – dann einfach anmelden.
import { NextResponse, type NextRequest } from "next/server";
import { accountsEnabled, safeNext } from "@/lib/supabase/config";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"), "/account");
  if (accountsEnabled && code) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }
  const fallback = next === "/account/new-password" ? "/reset-password?expired=1" : "/login?confirmed=1";
  return NextResponse.redirect(new URL(fallback, url.origin));
}
