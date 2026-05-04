"use client";

import { useEffect, useState, useTransition } from "react";
import { LogIn, LogOut, Shield, UserPlus, Wallet } from "lucide-react";
import { Button, Pill } from "@/components/ui";

type BillingStatus = {
  currentUser: {
    id: string;
    name: string | null;
    email: string;
    roleLabel: string;
    planLabel: string;
    accessSummary: string;
    subscriptionEndsAt: string | null;
    creditBalance: number;
    canCreateSession: boolean;
    isUnlimited: boolean;
  } | null;
  sessionCreateCreditCost: number;
};

export function AccountStrip({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [pending, startTransition] = useTransition();

  async function load() {
    const res = await fetch("/api/billing/status", { cache: "no-store" });
    setStatus(await res.json());
  }

  useEffect(() => {
    void load();
  }, []);

  async function logout() {
    startTransition(() => {
      void (async () => {
        await fetch("/api/account/logout", { method: "POST" });
        window.location.reload();
      })();
    });
  }

  if (!status?.currentUser) {
    return (
      <div className={`rounded-2xl border border-slate-200 bg-white ${compact ? "p-3" : "p-3 sm:p-4"}`}>
        <div className={`flex ${compact ? "flex-col" : "flex-col sm:flex-row sm:items-center sm:justify-between"} gap-3 border border-[var(--line)] bg-[linear-gradient(180deg,rgba(255,255,255,0.94)_0%,rgba(239,246,235,0.88)_100%)] ${compact ? "p-3" : "p-3.5 sm:p-4"} shadow-[0_14px_32px_rgba(18,41,28,0.06)]`}>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <strong className="text-sm text-[var(--text)]">No account signed in</strong>
              <Pill tone="amber">Credits required</Pill>
            </div>
            <div className="mt-1 text-xs font-medium text-[var(--muted)]">Sign in or create an account before topping up credits.</div>
          </div>
          <div className={`grid gap-2 ${compact ? "" : "sm:grid-cols-2"}`}>
            <a href="/login">
              <Button variant="soft" className="w-full">
                <LogIn size={15} />
                Sign in
              </Button>
            </a>
            <a href="/register">
              <Button className="w-full">
                <UserPlus size={15} />
                Create account
              </Button>
            </a>
          </div>
        </div>
      </div>
    );
  }

  const currentUser = status.currentUser;

  return (
    <div className={`rounded-2xl border border-slate-200 bg-white ${compact ? "p-3" : "p-3 sm:p-4"}`}>
      <div className={`flex ${compact ? "flex-col" : "flex-col sm:flex-row sm:items-center sm:justify-between"} gap-3 rounded-[24px] border border-[var(--line)] bg-[linear-gradient(180deg,rgba(255,255,255,0.94)_0%,rgba(239,246,235,0.88)_100%)] ${compact ? "p-3" : "p-3.5 sm:p-4"} shadow-[0_14px_32px_rgba(18,41,28,0.06)]`}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="truncate text-sm text-[var(--text)]">{currentUser.name || currentUser.email}</strong>
            <Pill tone={currentUser.roleLabel === "Admin" ? "purple" : currentUser.canCreateSession ? "green" : "slate"}>
              {currentUser.roleLabel}
            </Pill>
            <Pill tone={currentUser.canCreateSession ? "blue" : "amber"}>{currentUser.planLabel}</Pill>
          </div>
          <div className="mt-1 text-xs font-medium text-[var(--muted)]">{currentUser.accessSummary}</div>
          <div className="mt-1 text-xs text-[var(--muted)]">
            {currentUser.isUnlimited ? "Admin does not spend credits" : `${status.sessionCreateCreditCost} credits are used per new session`}
          </div>
        </div>

        <div className={`grid gap-2 ${compact ? "" : "sm:grid-cols-3"}`}>
          <a href="/account/billing">
            <Button variant="soft" className="w-full">
              <Wallet size={15} />
              Credits
            </Button>
          </a>
          <a href="/billing/upgrade">
            <Button className="w-full">
              <Shield size={15} />
              Top up
            </Button>
          </a>
          <Button variant="soft" className="w-full" onClick={logout} loading={pending}>
            <LogOut size={15} />
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}
