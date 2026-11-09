"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { Field, NeedsAccounts, Notice, Submit, PasswordRules } from "@/components/account/Form";
import { RequireUser } from "@/components/account/RequireUser";
import { authMessage } from "@/lib/auth";
import { MIN_PASSWORD } from "@/lib/supabase/config";
import { passwordProblem } from "@/lib/password";
import { supabaseBrowser } from "@/lib/supabase/client";

const fmt = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "–";

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[var(--radius-panel)] bg-surface p-6 ring-1 ring-line">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function ChangePassword() {
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const problem = passwordProblem(password);
    if (problem) return setMsg({ kind: "error", text: problem });
    if (password !== repeat) return setMsg({ kind: "error", text: "The two passwords don't match." });
    setBusy(true);
    const sb = supabaseBrowser()!;
    const { error } = await sb.auth.updateUser({ password });
    if (!error) await sb.auth.signOut({ scope: "others" });
    setBusy(false);
    setMsg(error ? { kind: "error", text: authMessage(error) } : { kind: "ok", text: "Password changed. Other devices were signed out." });
    if (!error) {
      setPassword("");
      setRepeat("");
    }
  }

  return (
    <form onSubmit={submit} className="flex max-w-sm flex-col gap-4">
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <Field label="New password" type="password" value={password} onChange={setPassword} autoComplete="new-password"
        />
        <PasswordRules password={password} />
      <Field label="Repeat new password" type="password" value={repeat} onChange={setRepeat} autoComplete="new-password" />
      <Submit busy={busy}>Change password</Submit>
    </form>
  );
}

function DeleteAccount() {
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove(e: React.FormEvent) {
    e.preventDefault();
    if (confirm !== "DELETE") return setError("Please type DELETE to confirm.");
    setBusy(true);
    const sb = supabaseBrowser()!;
    const { error } = await sb.rpc("delete_own_account");
    if (error) {
      setBusy(false);
      return setError(authMessage(error));
    }
    await sb.auth.signOut();
    window.location.assign("/");
  }

  return (
    <form onSubmit={remove} className="flex max-w-sm flex-col gap-4">
      <p className="text-sm text-slate">
        Deletes your account and everything saved with it (settings, and later portfolios and transactions). This can&apos;t
        be undone.
      </p>
      {error && <Notice kind="error">{error}</Notice>}
      <Field label="Type DELETE to confirm" value={confirm} onChange={setConfirm} autoComplete="off" />
      <button type="submit" disabled={busy || confirm !== "DELETE"}
        className="h-11 rounded-[var(--radius-control)] border border-down font-semibold text-down hover:bg-down-soft disabled:opacity-50">
        {busy ? "Please wait…" : "Delete my account"}
      </button>
    </form>
  );
}

function Account({ user }: { user: User }) {
  const params = useSearchParams();
  async function signOut() {
    await supabaseBrowser()!.auth.signOut();
    window.location.assign("/"); // volle Seite neu, sonst leitet die Konto-Seite erst zur Anmeldung
  }
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 py-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-3xl">Your account</h1>
          <p className="mt-1 text-slate">{user.email} · member since {fmt(user.created_at)}</p>
        </div>
        <button type="button" onClick={signOut}
          className="h-10 rounded-[var(--radius-control)] px-4 font-semibold ring-1 ring-line hover:ring-ink">
          Sign out
        </button>
      </div>
      {params.get("password") && <Notice kind="ok">Your new password is saved.</Notice>}
      <Box title="Settings">
        <p className="text-sm text-slate">
          Your display settings – EU only, the list settings on the market page and the last game you looked at – are saved
          to your account and follow you to every device.
        </p>
      </Box>
      <Box title="Password"><ChangePassword /></Box>
      <Box title="Delete account"><DeleteAccount /></Box>
    </div>
  );
}

export default function AccountPage() {
  return (
    <NeedsAccounts>
      <RequireUser>{(user) => <Suspense><Account user={user} /></Suspense>}</RequireUser>
    </NeedsAccounts>
  );
}
