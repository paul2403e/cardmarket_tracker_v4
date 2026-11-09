// Hält die Anmeldung frisch: Supabase erneuert abgelaufene Sitzungs-Cookies hier, bevor eine Seite lädt.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_KEY, SUPABASE_URL, accountsEnabled } from "@/lib/supabase/config";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  if (!accountsEnabled) return response;
  // nur wer schon angemeldet war, hat Supabase-Cookies – alle anderen kosten hier nichts
  if (!request.cookies.getAll().some((c) => c.name.startsWith("sb-"))) return response;
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });
  await supabase.auth.getClaims();
  return response;
}

export const config = {
  // keine Bilder, Skripte, Marktdaten
  matcher: ["/((?!_next/static|_next/image|api/data|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)"],
};
