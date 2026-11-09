"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field, NeedsAccounts, Notice, Panel, Submit } from "@/components/account/Form";
import { RequireUser } from "@/components/account/RequireUser";
import { authMessage } from "@/lib/auth";
import { MIN_PASSWORD } from "@/lib/supabase/config";
import { supabaseBrowser } from "@/lib/supabase/client";

/** Nach dem Link aus der „Passwort vergessen“-Mail: neues Passwort setzen. */
function NewPassword() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < MIN_PASSWORD) return setError(`Please use at least ${MIN_PASSWORD} characters.`);
    if (password !== repeat) return setError("The two passwords don't match.");
    setBusy(true);
    setError(null);
    const sb = supabaseBrowser()!;
    const { error } = await sb.auth.updateUser({ password });
    if (error) {
      setBusy(false);
      return setError(authMessage(error));
    }
    await sb.auth.signOut({ scope: "others" }); // andere Geräte abmelden
    router.replace("/account?password=1");
  }

  return (
    <Panel title="Set a new password">
      <form onSubmit={submit} className="flex flex-col gap-4">
        {error && <Notice kind="error">{error}</Notice>}
        <Field label="New password" type="password" value={password} onChange={setPassword} autoComplete="new-password"
          minLength={MIN_PASSWORD} hint={`At least ${MIN_PASSWORD} characters.`} />
        <Field label="Repeat new password" type="password" value={repeat} onChange={setRepeat} autoComplete="new-password" />
        <Submit busy={busy}>Save password</Submit>
      </form>
    </Panel>
  );
}

export default function NewPasswordPage() {
  return <NeedsAccounts><RequireUser>{() => <NewPassword />}</RequireUser></NeedsAccounts>;
}
