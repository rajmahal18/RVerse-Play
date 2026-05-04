"use client";

import { useEffect, useState } from "react";
import { Shield, Wallet } from "lucide-react";
import { AccountStrip } from "@/components/account-strip";
import { Button, Pill, Section } from "@/components/ui";

type BillingStatus = {
  currentUser: {
    canCreateSession: boolean;
    planLabel: string;
    roleLabel: string;
  } | null;
  monthlyPrice: number;
};

function formatPhp(amount: number) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(amount / 100);
}

export default function UpgradePage() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/billing/status", { cache: "no-store" }).then(async (res) => setStatus(await res.json()));
  }, []);

  async function upgrade() {
    setBusy(true);
    setError("");
    const res = await fetch("/api/billing/paymongo/create-checkout", { method: "POST" });
    const data = await res.json();

    if (!res.ok) {
      setError(data.error || "Could not start checkout.");
      setBusy(false);
      return;
    }

    if (data.checkoutUrl) {
      window.location.href = data.checkoutUrl;
      return;
    }

    setError("No checkout URL returned.");
    setBusy(false);
  }

  return (
    <main className="mx-auto max-w-3xl px-3 py-4 sm:px-6">
      <div className="space-y-4">
        <a href="/" className="inline-flex text-sm font-semibold text-blue-600">Back to sessions</a>
        <AccountStrip compact />
        <Section title="Organizer Access" action={<Pill tone="blue">{status ? formatPhp(status.monthlyPrice) : "₱199"} / month</Pill>}>
          <div className="space-y-4">
            <div className="space-y-2 text-sm text-slate-600">
              <div>Create unlimited open play sessions.</div>
              <div>Invite players for free.</div>
            </div>
            {error && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</div>}
            {status?.currentUser?.canCreateSession ? (
              <a href="/" className="block">
                <Button className="w-full">
                  <Shield size={16} />
                  Create session
                </Button>
              </a>
            ) : (
              <Button onClick={upgrade} disabled={busy} loading={busy} className="w-full">
                <Wallet size={16} />
                Upgrade with PayMongo
              </Button>
            )}
          </div>
        </Section>
      </div>
    </main>
  );
}
