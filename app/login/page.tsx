"use client";

import { useState } from "react";
import { LogIn } from "lucide-react";
import { Button, Input, Section } from "@/components/ui";
import { JoinSessionForm } from "@/components/join-session-form";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");

    const res = await fetch("/api/account/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();

    if (!res.ok) {
      setError(data.error || "Could not sign in.");
      setBusy(false);
      return;
    }

    window.location.href = "/";
  }

  return (
    <main className="mx-auto max-w-md px-3 py-8 sm:px-6">
      <div className="space-y-4">
        <div className="text-xl font-black text-[var(--text)]">RVerse Play</div>
        <Section title="Sign In">
          <form onSubmit={submit} className="space-y-4">
            <Field label="Email">
              <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            </Field>
            <Field label="Password">
              <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
            </Field>
            {error && <div className="border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</div>}
            <Button type="submit" className="w-full" loading={busy}>
              <LogIn size={16} />
              Sign in
            </Button>
            <a href="/register" className="block text-center text-sm font-semibold text-blue-600">Create account</a>
          </form>
        </Section>
        <Section title="Join Session">
          <JoinSessionForm />
        </Section>
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted)]">{label}</span>
      {children}
    </label>
  );
}
