"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Field, NeedsAccounts, Notice, Panel, Submit } from "@/components/account/Form";
import { authMessage } from "@/lib/auth";
import { gameHref, rememberedGame } from "@/lib/games";
import { safeNext } from "@/lib/supabase/config";
import { supabaseBrowser } from "@/lib/supabase/client";

function Login() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const info = params.get("confirmed") ? "Your email is confirmed. Please sign in." :
    params.get("reset") ? "Password changed. Please sign in with your new password." : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabaseBrowser()!.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) return setError(authMessage(error));
    router.replace(safeNext(params.get("next"), gameHref(rememberedGame())));
    router.refresh();
  }

  return (
    <Panel title="Sign in" intro={<>No account yet? <Link href="/signup" className="text-cobalt hover:underline">Create one</Link></>}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {info && <Notice kind="ok">{info}</Notice>}
        {error && <Notice kind="error">{error}</Notice>}
        <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <Field label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
        <Submit busy={busy}>Sign in</Submit>
        <Link href="/reset-password" className="text-center text-sm text-cobalt hover:underline">Forgot your password?</Link>
      </form>
    </Panel>
  );
}

export default function LoginPage() {
  return (
    <NeedsAccounts>
      <Suspense><Login /></Suspense>
    </NeedsAccounts>
  );
}
