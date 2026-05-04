"use client";

import { useEffect, useState } from "react";
import { Shield, Wallet, Zap } from "lucide-react";
import { AccountStrip } from "@/components/account-strip";
import { Button, Pill, Section, Select } from "@/components/ui";

type BillingStatus = {
  currentUser: {
    canCreateSession: boolean;
    planLabel: string;
    roleLabel: string;
    creditBalance: number;
    isUnlimited: boolean;
  } | null;
  creditPrice: number;
  defaultTopUpCredits: number;
  sessionCreateCreditCost: number;
};

function formatPhp(amount: number) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(amount / 100);
}

export default function UpgradePage() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [credits, setCredits] = useState(50);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/billing/status", { cache: "no-store" }).then(async (res) => {
      const data = await res.json();
      setStatus(data);
      setCredits(data.defaultTopUpCredits || 50);
    });
  }, []);

  async function upgrade() {
    setBusy(true);
    setError("");
    const res = await fetch("/api/billing/paymongo/create-checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credits }),
    });
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

  const creditPrice = status?.creditPrice || 1000;
  const topUpAmount = credits * creditPrice;

  return (
    <main className="mx-auto max-w-3xl px-3 py-4 sm:px-6">
      <div className="space-y-4">
        <a href="/" className="inline-flex text-sm font-semibold text-blue-600">Back to sessions</a>
        <AccountStrip compact />
        <Section title="Top Up Credits" action={<Pill tone="blue">{formatPhp(creditPrice)} / credit</Pill>}>
          <div className="space-y-4">
            <label className="grid gap-1.5">
              <span className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted)]">Credits to buy</span>
              <Select value={credits} onChange={(event) => setCredits(Number(event.target.value))}>
                <option value={10}>10 credits - {formatPhp(10 * creditPrice)}</option>
                <option value={20}>20 credits - {formatPhp(20 * creditPrice)}</option>
                <option value={50}>50 credits - {formatPhp(50 * creditPrice)}</option>
                <option value={100}>100 credits - {formatPhp(100 * creditPrice)}</option>
              </Select>
            </label>
            {error && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</div>}
            {!status?.currentUser ? (
              <a href="/login" className="block">
                <Button className="w-full">
                  <Shield size={16} />
                  Sign in to top up
                </Button>
              </a>
            ) : status.currentUser.isUnlimited ? (
              <a href="/" className="block">
                <Button className="w-full">
                  <Shield size={16} />
                  Admin unlimited
                </Button>
              </a>
            ) : (
              <Button onClick={upgrade} disabled={busy} loading={busy} className="w-full">
                <Wallet size={16} />
                Pay {formatPhp(topUpAmount)} with PayMongo
              </Button>
            )}
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
              <Zap size={14} />
              Current balance: {status?.currentUser?.creditBalance || 0} credits
            </div>
          </div>
        </Section>
      </div>
    </main>
  );
}
