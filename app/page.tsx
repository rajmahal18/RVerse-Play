"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, CircleDot, Plus, Sparkles, Trophy, Users, Zap } from "lucide-react";
import { Button, Input, Select, Section, Pill } from "@/components/ui";
import { AccountStrip } from "@/components/account-strip";

type Session = {
  id: string;
  name: string;
  courtCount: number;
  rotationMode: string;
  skillBalancing: boolean;
  createdAt: string;
  owner?: { id: string; name: string | null; email: string } | null;
  _count: { players: number; matches: number };
};

type BillingStatus = { currentUser: { canCreateSession: boolean } | null };

const rotationCopy: Record<string, string> = {
  FAIR_ROTATION: "Balanced turns for everyone",
  SKILL_BALANCED: "Keeps team levels closer",
  WINNER_STAYS: "Fast-moving challenge court",
  LOCKED_PAIRS: "Stable partners each round",
};

export default function Home() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [name, setName] = useState("Saturday Open Play");
  const [courtCount, setCourtCount] = useState(2);
  const [rotationMode, setRotationMode] = useState("FAIR_ROTATION");
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [creatingSession, setCreatingSession] = useState(false);

  async function load() {
    const [sessionsRes, billingRes] = await Promise.all([
      fetch("/api/sessions", { cache: "no-store" }),
      fetch("/api/billing/status", { cache: "no-store" }),
    ]);
    setSessions(await sessionsRes.json());
    setBilling(await billingRes.json());
  }

  useEffect(() => {
    void load();
  }, []);

  async function createSession() {
    setCreatingSession(true);
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, courtCount, rotationMode, skillBalancing: true }),
    });
    const session = await res.json();
    if (!res.ok && session?.billingUrl) {
      window.location.href = session.billingUrl;
      return;
    }
    window.location.href = `/sessions/${session.id}`;
  }

  const totals = useMemo(() => {
    return sessions.reduce(
      (acc, session) => {
        acc.players += session._count.players;
        acc.matches += session._count.matches;
        acc.courts += session.courtCount;
        return acc;
      },
      { players: 0, matches: 0, courts: 0 },
    );
  }, [sessions]);

  return (
    <main className="mx-auto max-w-6xl px-3 py-4 sm:px-6">
      <header className="sticky top-0 z-10 -mx-3 mb-4 border-b border-white/60 bg-[rgba(246,247,241,0.9)] px-3 py-3 backdrop-blur-md sm:-mx-6 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-emerald-700/10 bg-[linear-gradient(180deg,#d8f05f_0%,#9fdb68_100%)] text-emerald-950 shadow-[0_10px_20px_rgba(159,219,104,0.25)]">
              <Trophy size={18} />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-[1.05rem] font-black tracking-[0.01em] text-[var(--text)]">CourtFlow</h1>
              <div className="text-xs font-medium text-[var(--muted)]">Open play control desk</div>
            </div>
          </div>
          <Pill tone="green">Pickleball MVP</Pill>
        </div>
      </header>

      <div className="grid gap-4">
        <AccountStrip />

        <section className="court-shell overflow-hidden rounded-[28px] border border-[var(--line)] bg-[linear-gradient(135deg,rgba(255,255,255,0.96)_0%,rgba(239,246,235,0.92)_55%,rgba(243,248,201,0.72)_100%)] shadow-[0_22px_48px_rgba(18,41,28,0.08)]">
          <div className="grid gap-5 px-4 py-5 sm:px-5 lg:grid-cols-[1.25fr_0.9fr] lg:items-end">
            <div className="min-w-0">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Pill tone="amber">Organizer lane</Pill>
                <Pill tone="blue">{billing?.currentUser?.canCreateSession ? "Ready to create" : "Upgrade required"}</Pill>
              </div>
              <h2 className="max-w-xl text-2xl font-black leading-tight text-[var(--text)] sm:text-[2rem]">
                Build cleaner open play sessions that look and feel like a real court board.
              </h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--muted)]">
                Start a session, keep the queue visible, and rotate players without the usual organizer chaos.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              <StatTile icon={<Users size={15} />} label="Players live" value={totals.players} tone="green" />
              <StatTile icon={<Zap size={15} />} label="Courts setup" value={totals.courts} tone="blue" />
              <StatTile icon={<Sparkles size={15} />} label="Matches run" value={totals.matches} tone="amber" />
            </div>
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-[370px_1fr]">
          <Section
            title="New Session"
            action={<Pill tone={billing?.currentUser?.canCreateSession ? "green" : "amber"}>{billing?.currentUser?.canCreateSession ? "Organizer ready" : "Upgrade needed"}</Pill>}
          >
            <div className="space-y-4">
              <div className="rounded-[22px] border border-[var(--line)] bg-[linear-gradient(180deg,rgba(255,255,255,0.95)_0%,rgba(243,248,201,0.38)_100%)] p-3.5">
                <div className="grid gap-3">
                  <Field label="Session name">
                    <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Saturday Open Play" />
                  </Field>
                  <Field label="Number of courts">
                    <Input type="number" min={1} max={12} value={courtCount} onChange={(e) => setCourtCount(Number(e.target.value))} />
                  </Field>
                  <Field label="Rotation style">
                    <Select value={rotationMode} onChange={(e) => setRotationMode(e.target.value)}>
                      <option value="FAIR_ROTATION">Fair Rotation</option>
                      <option value="SKILL_BALANCED">Skill Balanced</option>
                      <option value="WINNER_STAYS">Winner Stays</option>
                      <option value="LOCKED_PAIRS">Locked Pairs</option>
                    </Select>
                  </Field>
                </div>
              </div>

              <div className="rounded-[22px] border border-dashed border-[var(--line-strong)] bg-[var(--bg-soft)] px-3.5 py-3">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-2xl bg-white text-emerald-700 shadow-[0_6px_16px_rgba(18,41,28,0.08)]">
                    <CircleDot size={14} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-[var(--text)]">{rotationMode.replaceAll("_", " ")}</div>
                    <div className="mt-1 text-xs leading-5 text-[var(--muted)]">{rotationCopy[rotationMode] || "Flexible open play rotation."}</div>
                  </div>
                </div>
              </div>

              <Button onClick={createSession} className="w-full" loading={creatingSession}>
                <Plus size={16} />
                {billing?.currentUser?.canCreateSession ? "Create session" : "Upgrade to create"}
              </Button>
            </div>
          </Section>

          <Section title="Session Board" action={<Pill tone="slate">{sessions.length} active</Pill>}>
            <div className="court-grid overflow-hidden rounded-[24px] border border-[var(--line)] bg-white/70">
              {sessions.map((session) => (
                <a
                  key={session.id}
                  href={`/sessions/${session.id}`}
                  className="flex items-start justify-between gap-3 border-b border-[var(--line)] px-4 py-4 transition hover:bg-white/80 last:border-b-0"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="truncate text-sm font-black text-[var(--text)]">{session.name}</strong>
                      <Pill tone={session.skillBalancing ? "green" : "slate"}>{session.skillBalancing ? "Smart balance" : "Manual feel"}</Pill>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Pill>{session.courtCount} courts</Pill>
                      <Pill tone="green">{session._count.players} players</Pill>
                      <Pill tone="purple">{session._count.matches} matches</Pill>
                      {session.owner && <Pill tone="slate">by {session.owner.name || session.owner.email}</Pill>}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[var(--muted)]">
                      <span className="inline-flex items-center gap-1"><CalendarDays size={13} />{new Date(session.createdAt).toLocaleDateString()}</span>
                      <span className="inline-flex items-center gap-1"><Sparkles size={13} />{session.rotationMode.replaceAll("_", " ").toLowerCase()}</span>
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">Open</span>
                </a>
              ))}
              {!sessions.length && (
                <div className="px-4 py-12 text-center text-sm text-[var(--muted)]">
                  No sessions yet. Start one on the left and your court board will appear here.
                </div>
              )}
            </div>
          </Section>
        </div>
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

function StatTile({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: "green" | "blue" | "amber";
}) {
  const tones = {
    green: "bg-white/90 text-emerald-700",
    blue: "bg-white/90 text-sky-700",
    amber: "bg-white/90 text-lime-700",
  } as const;

  return (
    <div className={`rounded-[22px] border border-white/70 p-3 shadow-[0_10px_24px_rgba(18,41,28,0.06)] ${tones[tone]}`}>
      <div className="mb-3 inline-flex rounded-2xl bg-[var(--bg-soft)] p-2">{icon}</div>
      <div className="text-xl font-black">{value}</div>
      <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--muted)]">{label}</div>
    </div>
  );
}
