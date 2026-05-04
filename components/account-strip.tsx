"use client";

import { useEffect, useState, useTransition } from "react";
import { Shield, Wallet } from "lucide-react";
import { Button, Pill, Select } from "@/components/ui";

type BillingStatus = {
  currentUser: {
    id: string;
    name: string | null;
    email: string;
    roleLabel: string;
    planLabel: string;
    accessSummary: string;
    subscriptionEndsAt: string | null;
    canCreateSession: boolean;
  } | null;
  users: {
    id: string;
    name: string | null;
    email: string;
    roleLabel: string;
    planLabel: string;
    canCreateSession: boolean;
  }[];
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

  async function switchUser(userId: string) {
    startTransition(() => {
      void (async () => {
        await fetch("/api/account/acting-user", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId }),
        });
        await load();
        window.location.reload();
      })();
    });
  }

  if (!status?.currentUser) {
    return <div className="rounded-[24px] border border-[var(--line)] bg-white/80 px-3 py-2.5 text-sm text-[var(--muted)] shadow-[0_12px_28px_rgba(18,41,28,0.06)]">Loading access...</div>;
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
          {currentUser.subscriptionEndsAt && (
            <div className="mt-1 text-xs text-[var(--muted)]">Access until {new Date(currentUser.subscriptionEndsAt).toLocaleDateString()}</div>
          )}
        </div>

        <div className={`grid gap-2 ${compact ? "" : "sm:grid-cols-[minmax(0,220px)_auto_auto]"}`}>
          <Select
            value={currentUser.id}
            onChange={(event) => switchUser(event.target.value)}
            disabled={pending}
            aria-label="Switch acting user"
          >
            {status.users.map((user) => (
              <option key={user.id} value={user.id}>
                {(user.name || user.email) + " - " + user.roleLabel + " - " + user.planLabel}
              </option>
            ))}
          </Select>
          <a href="/account/billing">
            <Button variant="soft" className="w-full">
              <Wallet size={15} />
              Billing
            </Button>
          </a>
          <a href="/billing/upgrade">
            <Button className="w-full">
              <Shield size={15} />
              Upgrade
            </Button>
          </a>
        </div>
      </div>
    </div>
  );
}
