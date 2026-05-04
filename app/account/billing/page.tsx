"use client";

import { useEffect, useState } from "react";
import { AccountStrip } from "@/components/account-strip";
import { Button, Pill, Section } from "@/components/ui";

type BillingPageStatus = {
  currentUser: {
    planLabel: string;
    roleLabel: string;
    subscriptionStatus: string;
    subscriptionEndsAt: string | null;
    creditBalance: number;
    canCreateSession: boolean;
    isUnlimited: boolean;
  } | null;
  payments: { id: string; status: string; amount: number; currency: string; createdAt: string }[];
  creditPrice: number;
  sessionCreateCreditCost: number;
};

function formatPhp(amount: number) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(amount / 100);
}

export default function BillingAccountPage() {
  const [status, setStatus] = useState<BillingPageStatus | null>(null);

  useEffect(() => {
    fetch("/api/billing/status", { cache: "no-store" }).then(async (res) => setStatus(await res.json()));
  }, []);

  return (
    <main className="mx-auto max-w-4xl px-3 py-4 sm:px-6">
      <div className="space-y-4">
        <a href="/" className="inline-flex text-sm font-semibold text-blue-600">Back to sessions</a>
        <AccountStrip compact />
        <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
          <Section title="Credits" action={<Pill tone={status?.currentUser?.canCreateSession ? "green" : "amber"}>{status?.currentUser?.planLabel || "0 credits"}</Pill>}>
            <div className="space-y-3 text-sm text-slate-600">
              <div>Role: {status?.currentUser?.roleLabel || "User"}</div>
              <div>Balance: {status?.currentUser?.isUnlimited ? "Unlimited" : `${status?.currentUser?.creditBalance || 0} credits`}</div>
              <div>Session cost: {status?.sessionCreateCreditCost || 5} credits</div>
              <a href="/billing/upgrade" className="block">
                <Button className="w-full">{status?.currentUser?.isUnlimited ? "Admin unlimited" : "Top up credits"}</Button>
              </a>
            </div>
          </Section>

          <Section title="Recent Payments" action={<Pill tone="blue">{formatPhp(status?.creditPrice || 1000)} / credit</Pill>}>
            <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-100 bg-white">
              {status?.payments?.length ? status.payments.map((payment) => (
                <div key={payment.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900">{formatPhp(payment.amount)}</div>
                    <div className="text-xs text-slate-500">{new Date(payment.createdAt).toLocaleString()}</div>
                  </div>
                  <Pill tone={payment.status === "PAID" ? "green" : payment.status === "FAILED" ? "red" : "amber"}>{payment.status}</Pill>
                </div>
              )) : <div className="p-6 text-center text-sm text-slate-500">No billing activity yet.</div>}
            </div>
          </Section>
        </div>
      </div>
    </main>
  );
}
