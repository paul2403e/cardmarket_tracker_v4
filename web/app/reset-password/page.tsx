"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Field, NeedsAccounts, Notice, Panel, Submit } from "@/components/account/Form";
import { authMessage } from "@/lib/auth";
import { supabaseBrowser } from "@/lib/supabase/client";

function Reset() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const expired = useSearchParams().get("expired");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabaseBrowser()!.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/callback?next=/account/new-password`,
    });
    setBusy(false);
    if (error) return setError(authMessage(error));
    setSent(true);
  }

  return (
    <Panel title="Reset password" intro={<Link href="/login" className="text-cobalt hover:underline">Back to sign in</Link>}>
      {sent ? (
        <p>If there is an account for <strong>{email.trim()}</strong>, a link to set a new password is on its way.</p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          {expired && !error && (
            <Notice kind="error">This link has expired or was opened in another browser. Please request a new one.</Notice>
          )}
          {error && <Notice kind="error">{error}</Notice>}
          <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
          <Submit busy={busy}>Send link</Submit>
        </form>
      )}
    </Panel>
  );
}

export default function ResetPage() {
  return <NeedsAccounts><Suspense><Reset /></Suspense></NeedsAccounts>;
}
