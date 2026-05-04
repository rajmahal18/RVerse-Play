"use client";

import { useState } from "react";
import { LogIn, Search } from "lucide-react";
import { Button, Input, Select } from "@/components/ui";

type JoinLookup = {
  id: string;
  name: string;
  currentPlayerId: string | null;
  players: { id: string; name: string; status: string; occupied: boolean }[];
};

export function JoinSessionForm({ defaultName = "" }: { defaultName?: string }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState(defaultName);
  const [lookup, setLookup] = useState<JoinLookup | null>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");

  async function verifyCode() {
    if (!code.trim()) return;
    setVerifying(true);
    setError("");
    setLookup(null);
    setSelectedPlayerId("");

    const res = await fetch(`/api/sessions/join?code=${encodeURIComponent(code)}`, { cache: "no-store" });
    const data = await res.json();

    if (!res.ok) {
      setError(data.error || "Could not find session.");
      setVerifying(false);
      return;
    }

    setLookup(data);
    if (data.currentPlayerId) setSelectedPlayerId(data.currentPlayerId);
    setVerifying(false);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");

    const res = await fetch("/api/sessions/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name, playerId: selectedPlayerId || undefined }),
    });
    const data = await res.json();

    if (!res.ok) {
      setError(data.error || "Could not join session.");
      setBusy(false);
      return;
    }

    window.location.href = data.url;
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <label className="grid gap-1.5">
        <span className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted)]">Session code</span>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Input
            value={code}
            onChange={(event) => {
              setCode(event.target.value.toUpperCase());
              setLookup(null);
              setSelectedPlayerId("");
            }}
            placeholder="ABC123"
            maxLength={8}
            required
          />
          <Button type="button" variant="soft" onClick={verifyCode} loading={verifying}>
            <Search size={15} />
            Verify
          </Button>
        </div>
      </label>
      {lookup && (
        <div className="border border-[var(--line)] bg-white/70 px-3 py-2 text-sm font-semibold text-[var(--text)]">
          {lookup.name}
        </div>
      )}
      {lookup?.players.length ? (
        <label className="grid gap-1.5">
          <span className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted)]">Player</span>
          <Select
            value={selectedPlayerId || "new"}
            onChange={(event) => {
              const value = event.target.value;
              setSelectedPlayerId(value === "new" ? "" : value);
            }}
          >
            <option value="new">New player</option>
            {lookup.players.map((player) => (
              <option key={player.id} value={player.id} disabled={player.occupied}>
                {player.name} - {player.occupied ? "in use" : player.status.toLowerCase()}
              </option>
            ))}
          </Select>
        </label>
      ) : null}
      {!selectedPlayerId && (
        <label className="grid gap-1.5">
          <span className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted)]">Player name</span>
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" required={!selectedPlayerId} />
        </label>
      )}
      {error && <div className="border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</div>}
      <Button type="submit" loading={busy} className="w-full" disabled={!lookup}>
        <LogIn size={16} />
        Join session
      </Button>
    </form>
  );
}
