"use client";

import Link from "next/link";
import { useState } from "react";
import { Field, NeedsAccounts, Notice, Panel, Submit } from "@/components/account/Form";
import { authMessage } from "@/lib/auth";
import { MIN_PASSWORD } from "@/lib/supabase/config";
import { supabaseBrowser } from "@/lib/supabase/client";

function Signup() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < MIN_PASSWORD) return setError(`Please use at least ${MIN_PASSWORD} characters.`);
    if (password !== repeat) return setError("The two passwords don't match.");
    if (!accepted) return setError("Please accept the privacy policy.");
    setBusy(true);
    setError(null);
    const { error } = await supabaseBrowser()!.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/account` },
    });
    setBusy(false);
    if (error) return setError(authMessage(error));
    setSent(true);
  }

  if (sent) {
    return (
      <Panel title="Check your email">
        <p>
          We sent a confirmation link to <strong>{email.trim()}</strong>. Open it to activate your account. The mail can
          take a minute – also check your spam folder.
        </p>
      </Panel>
    );
  }

  return (
    <Panel title="Create account" intro={<>Already have one? <Link href="/login" className="text-cobalt hover:underline">Sign in</Link></>}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {error && <Notice kind="error">{error}</Notice>}
        <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <Field label="Password" type="password" value={password} onChange={setPassword} autoComplete="new-password"
          minLength={MIN_PASSWORD} hint={`At least ${MIN_PASSWORD} characters.`} />
        <Field label="Repeat password" type="password" value={repeat} onChange={setRepeat} autoComplete="new-password" />
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-0.5 accent-cobalt" />
          <span>I have read the <Link href="/privacy" className="text-cobalt hover:underline">privacy policy</Link>.</span>
        </label>
        <Submit busy={busy}>Create account</Submit>
      </form>
    </Panel>
  );
}

export default function SignupPage() {
  return <NeedsAccounts><Signup /></NeedsAccounts>;
}
