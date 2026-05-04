"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Coffee,
  Equal,
  History,
  ListOrdered,
  LogOut,
  Play,
  Plus,
  Settings,
  Shuffle,
  TimerReset,
  Users,
  XCircle,
  Zap,
} from "lucide-react";
import { Button, Input, Pill, Section, Select, Textarea } from "@/components/ui";
import { evaluateMatchup, generateMatchQueue, type MatchmakingRelationship, type MatchmakingSessionConfig, type MatchmakingWaitingPlayer } from "@/lib/matchmaking";

type Player = {
  id: string;
  name: string;
  skillLevel: "BEGINNER" | "INTERMEDIATE" | "ADVANCED";
  status: "WAITING" | "PLAYING" | "RESTING" | "LEFT";
  gamesPlayed: number;
  waitStartedAt: string;
  createdAt: string;
};
type MatchPlayer = { id: string; team: "A" | "B"; result: string; player: Player };
type Match = { id: string; courtNumber: number; status: "ACTIVE" | "FINISHED"; startedAt: string; endedAt?: string | null; winningTeam?: "A" | "B" | null; players: MatchPlayer[] };
type Relationship = { id: string; playerAId: string; playerBId: string; partnerCount: number; opponentCount: number; lastPartnerAt?: string | null };
type Session = { id: string; name: string; courtCount: number; rotationMode: string; skillBalancing: boolean; players: Player[]; matches: Match[]; relationships: Relationship[] };
type PreviewPlayer = Pick<Player, "id" | "name" | "skillLevel" | "gamesPlayed">;
type QueuedMatchup = { teamA: PreviewPlayer[]; teamB: PreviewPlayer[]; score: number; reasons: string[] };
type QueueDraft = { teamAIds: string[]; teamBIds: string[]; editing: boolean };
type Tab = "queue" | "courts" | "summary" | "players" | "history" | "settings";
type SummarySortKey = "games" | "wins" | "losses";

const statusTone = { WAITING: "amber", PLAYING: "blue", RESTING: "slate", LEFT: "red" } as const;
const skillLabel = { BEGINNER: "Beginner", INTERMEDIATE: "Intermediate", ADVANCED: "Advanced" };

function toQueueDrafts(matchups: QueuedMatchup[]) {
  return matchups.map((matchup) => ({
    teamAIds: matchup.teamA.map((player) => player.id),
    teamBIds: matchup.teamB.map((player) => player.id),
    editing: false,
  }));
}

async function readJsonSafe(res: Response) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as { error?: string; [key: string]: unknown };
  } catch {
    return null;
  }
}

export default function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const [sessionId, setSessionId] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [tab, setTab] = useState<Tab>("queue");
  const [names, setNames] = useState("");
  const [skillLevel, setSkillLevel] = useState("INTERMEDIATE");
  const [error, setError] = useState("");
  const [busyAction, setBusyAction] = useState<null | "addPlayers" | "generate" | "startQueued">(null);
  const [pendingResults, setPendingResults] = useState<Record<string, "A" | "B" | "DRAW" | undefined>>({});
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [playersSubTab, setPlayersSubTab] = useState<"list" | "check-in">("list");
  const [pendingPlayerId, setPendingPlayerId] = useState<string | null>(null);
  const [pendingMatchId, setPendingMatchId] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [queuedStartingIndex, setQueuedStartingIndex] = useState<number | null>(null);
  const [summarySort, setSummarySort] = useState<{ key: SummarySortKey; direction: "asc" | "desc" }>({
    key: "wins",
    direction: "desc",
  });
  const [queueDrafts, setQueueDrafts] = useState<QueueDraft[]>([]);

  useEffect(() => {
    void params.then((p) => setSessionId(p.id));
  }, [params]);

  async function load(id = sessionId) {
    if (!id) return;
    const res = await fetch(`/api/sessions/${id}`, { cache: "no-store" });
    setSession(await res.json());
  }

  useEffect(() => {
    void load();
  }, [sessionId]);

  const activeMatches = useMemo(
    () => session?.matches.filter((match) => match.status === "ACTIVE").sort((a, b) => a.courtNumber - b.courtNumber) ?? [],
    [session],
  );
  const waiting = useMemo(
    () =>
      session?.players
        .filter((player) => player.status === "WAITING")
        .sort((a, b) => new Date(a.waitStartedAt).getTime() - new Date(b.waitStartedAt).getTime() || a.gamesPlayed - b.gamesPlayed) ?? [],
    [session],
  );
  const playingCount = session?.players.filter((player) => player.status === "PLAYING").length ?? 0;
  const restingCount = session?.players.filter((player) => player.status === "RESTING").length ?? 0;
  const selectedPlayer = session?.players.find((player) => player.id === selectedPlayerId) ?? null;
  const summaryRows = useMemo(() => {
    if (!session) return [];

    const rows = new Map(
      session.players.map((player) => [
        player.id,
        {
          id: player.id,
          name: player.name,
          games: 0,
          wins: 0,
          losses: 0,
        },
      ]),
    );

    for (const match of session.matches) {
      if (match.status !== "FINISHED") continue;
      for (const entry of match.players) {
        const row = rows.get(entry.player.id);
        if (!row) continue;
        row.games += 1;
        if (entry.result === "WIN") row.wins += 1;
        if (entry.result === "LOSS") row.losses += 1;
      }
    }

    return [...rows.values()].sort((a, b) => {
      const direction = summarySort.direction === "asc" ? 1 : -1;
      const primary = (a[summarySort.key] - b[summarySort.key]) * direction;
      if (primary !== 0) return primary;
      const winsTie = (b.wins - a.wins) || (a.losses - b.losses) || (b.games - a.games);
      return winsTie || a.name.localeCompare(b.name);
    });
  }, [session, summarySort]);
  const queuedMatchups = useMemo(() => {
    if (!session) return [];

    const maxQueuedMatches = Math.min(session.courtCount, Math.floor(waiting.length / 4));
    return generateMatchQueue({
      session: {
        rotationMode: session.rotationMode as "FAIR_ROTATION" | "SKILL_BALANCED" | "WINNER_STAYS" | "LOCKED_PAIRS",
        skillBalancing: session.skillBalancing,
      },
      waitingPlayers: waiting.map((player) => ({ ...player, waitStartedAt: new Date(player.waitStartedAt) })),
      relationships: session.relationships.map((relationship) => ({
        ...relationship,
        lastPartnerAt: relationship.lastPartnerAt ? new Date(relationship.lastPartnerAt) : null,
      })),
      maxMatches: maxQueuedMatches,
      now: new Date(),
    }).map((generated) => ({
      teamA: generated.teamA.map((player) => ({ id: player.id, name: player.name, skillLevel: player.skillLevel, gamesPlayed: player.gamesPlayed })),
      teamB: generated.teamB.map((player) => ({ id: player.id, name: player.name, skillLevel: player.skillLevel, gamesPlayed: player.gamesPlayed })),
      score: generated.score,
      reasons: generated.reasons,
    }));
  }, [session, waiting]);
  useEffect(() => {
    setQueueDrafts(toQueueDrafts(queuedMatchups));
  }, [queuedMatchups]);

  const waitingPlayerMap = useMemo(() => new Map(waiting.map((player) => [player.id, player])), [waiting]);
  const matchmakingConfig = useMemo<MatchmakingSessionConfig | null>(
    () =>
      session
        ? {
            rotationMode: session.rotationMode as MatchmakingSessionConfig["rotationMode"],
            skillBalancing: session.skillBalancing,
          }
        : null,
    [session],
  );
  const matchmakingRelationships = useMemo<MatchmakingRelationship[]>(
    () =>
      session?.relationships.map((relationship) => ({
        ...relationship,
        lastPartnerAt: relationship.lastPartnerAt ? new Date(relationship.lastPartnerAt) : null,
      })) ?? [],
    [session],
  );
  const matchmakingWaiting = useMemo<MatchmakingWaitingPlayer[]>(
    () => waiting.map((player) => ({ ...player, waitStartedAt: new Date(player.waitStartedAt) })),
    [waiting],
  );

  const gameStats = useMemo(() => {
    const activePlayers = session?.players.filter((player) => player.status !== "LEFT") ?? [];
    if (!activePlayers.length) return { min: 0, max: 0, spread: 0, label: "No players" };
    const values = activePlayers.map((player) => player.gamesPlayed);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const spread = max - min;
    return { min, max, spread, label: spread <= 1 ? "Excellent" : spread <= 2 ? "Good" : "Needs balancing" };
  }, [session]);

  async function addPlayers() {
    if (!names.trim()) return;
    setBusyAction("addPlayers");
    await fetch(`/api/sessions/${sessionId}/players`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ names, skillLevel }),
    });
    setNames("");
    setBusyAction(null);
    setPlayersSubTab("list");
    void load();
  }

  async function updatePlayer(playerId: string, status: Player["status"]) {
    setPendingPlayerId(playerId);
    await fetch(`/api/sessions/${sessionId}/players/${playerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setPendingPlayerId(null);
    void load();
  }

  async function generate() {
    setBusyAction("generate");
    setError("");
    const res = await fetch(`/api/sessions/${sessionId}/generate`, { method: "POST" });
    const data = await readJsonSafe(res);
    if (!res.ok) setError(data?.error || "Could not generate match");
    setBusyAction(null);
    void load();
    setTab("courts");
  }

  async function startQueuedMatch(index: number) {
    const draft = queueDrafts[index];
    if (!draft) return;
    setBusyAction("startQueued");
    setQueuedStartingIndex(index);
    setError("");
    const res = await fetch(`/api/sessions/${sessionId}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamAIds: draft.teamAIds, teamBIds: draft.teamBIds }),
    });
    const data = await readJsonSafe(res);
    if (!res.ok) setError(data?.error || "Could not start queued match");
    setBusyAction(null);
    setQueuedStartingIndex(null);
    if (res.ok) {
      void load();
      setTab("courts");
    }
  }

  function updateQueueDraft(index: number, team: "A" | "B", slot: number, playerId: string) {
    if (!matchmakingConfig) return;
    setQueueDrafts((current) => {
      const baseDrafts = current.length ? current : toQueueDrafts(queuedMatchups);
      const nextDrafts = baseDrafts.map((draft) => ({
        ...draft,
        teamAIds: [...draft.teamAIds],
        teamBIds: [...draft.teamBIds],
      }));

      const target = nextDrafts[index];
      if (!target) return current;
      if (team === "A") target.teamAIds[slot] = playerId;
      else target.teamBIds[slot] = playerId;

      const usedBefore = new Set<string>();
      for (let draftIndex = 0; draftIndex <= index; draftIndex++) {
        for (const id of [...nextDrafts[draftIndex].teamAIds, ...nextDrafts[draftIndex].teamBIds]) usedBefore.add(id);
      }

      const remainingWaitingPlayers = matchmakingWaiting.filter((player) => !usedBefore.has(player.id));
      const regenerated = generateMatchQueue({
        session: matchmakingConfig,
        waitingPlayers: remainingWaitingPlayers,
        relationships: matchmakingRelationships,
        maxMatches: Math.max(0, nextDrafts.length - index - 1),
        now: new Date(),
      });

      for (let draftIndex = index + 1; draftIndex < nextDrafts.length; draftIndex++) {
        const regeneratedDraft = regenerated[draftIndex - index - 1];
        nextDrafts[draftIndex] = regeneratedDraft
          ? {
              teamAIds: regeneratedDraft.teamA.map((player) => player.id),
              teamBIds: regeneratedDraft.teamB.map((player) => player.id),
              editing: nextDrafts[draftIndex].editing,
            }
          : {
              teamAIds: [],
              teamBIds: [],
              editing: nextDrafts[draftIndex].editing,
            };
      }

      return nextDrafts.filter((draft, draftIndex) => draftIndex <= index || (draft.teamAIds.length === 2 && draft.teamBIds.length === 2));
    });
  }

  function toggleQueueEditing(index: number) {
    setQueueDrafts((current) => current.map((draft, draftIndex) => (draftIndex === index ? { ...draft, editing: !draft.editing } : draft)));
  }

  async function finish(matchId: string, result: "A" | "B" | "DRAW") {
    setPendingMatchId(matchId);
    const res = await fetch(`/api/sessions/${sessionId}/matches/${matchId}/finish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "FINISH", result }),
    });
    const data = await readJsonSafe(res);
    if (!res.ok) {
      setError(data?.error || "Could not finish match.");
      setPendingMatchId(null);
      return;
    }
    setPendingResults((current) => ({ ...current, [matchId]: undefined }));
    setError("");
    setPendingMatchId(null);
    void load();
  }

  async function cancelMatch(matchId: string) {
    setPendingMatchId(matchId);
    const res = await fetch(`/api/sessions/${sessionId}/matches/${matchId}/finish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "CANCEL" }),
    });
    const data = await readJsonSafe(res);
    if (!res.ok) {
      setError(data?.error || "Could not cancel match.");
      setPendingMatchId(null);
      return;
    }
    setPendingResults((current) => ({ ...current, [matchId]: undefined }));
    setError("");
    setPendingMatchId(null);
    void load();
  }

  async function saveSettings(formData: FormData) {
    setSavingSettings(true);
    await fetch(`/api/sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: formData.get("name"),
        courtCount: Number(formData.get("courtCount")),
        rotationMode: formData.get("rotationMode"),
        skillBalancing: formData.get("skillBalancing") === "on",
      }),
    });
    setSavingSettings(false);
    void load();
  }

  if (!session) return <div className="p-6 text-sm text-[var(--muted)]">Loading...</div>;

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "queue", label: "Queue", icon: <ListOrdered size={15} /> },
    { id: "courts", label: "Courts", icon: <Play size={15} /> },
    { id: "players", label: "Players", icon: <Users size={15} /> },
    { id: "history", label: "History", icon: <History size={15} /> },
    { id: "summary", label: "Summary", icon: <Equal size={15} /> },
    { id: "settings", label: "Settings", icon: <Settings size={15} /> },
  ];

  return (
    <main className="mx-auto max-w-6xl px-3 pb-20 sm:px-6">
      <header className="sticky top-0 z-20 -mx-3 border-b border-white/60 bg-[rgba(246,247,241,0.9)] px-3 py-3 backdrop-blur-md sm:-mx-6 sm:px-6">
        <div className="rounded-none border border-[var(--line)] bg-[linear-gradient(135deg,rgba(255,255,255,0.94)_0%,rgba(239,246,235,0.9)_58%,rgba(243,248,201,0.65)_100%)] px-3 py-3 shadow-[0_18px_36px_rgba(18,41,28,0.08)] sm:px-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <a href="/" className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-none border border-[var(--line)] bg-white/90 text-[var(--text)] shadow-[0_8px_20px_rgba(18,41,28,0.06)]">
                <ArrowLeft size={17} />
              </a>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="truncate text-lg font-black text-[var(--text)]">{session.name}</h1>
                  <Pill tone="green">{gameStats.label}</Pill>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Pill tone="blue">{session.courtCount} courts</Pill>
                  <Pill tone="amber">{waiting.length} waiting</Pill>
                  <Pill tone="purple">{session.rotationMode.replaceAll("_", " ").toLowerCase()}</Pill>
                </div>
              </div>
            </div>
            <Button onClick={generate} disabled={busyAction !== null} loading={busyAction === "generate"} className="shrink-0">
              <Shuffle size={16} />
              <span className="hidden sm:inline">Generate match</span>
            </Button>
          </div>

          <div className="mt-3 grid grid-cols-4 gap-1.5 sm:gap-2">
            <TopMetric label="Waiting" value={waiting.length} tone="amber" />
            <TopMetric label="Playing" value={playingCount} tone="blue" />
            <TopMetric label="Resting" value={restingCount} tone="green" />
            <TopMetric label="Spread" value={gameStats.spread} tone="slate" />
          </div>

          <nav className="no-scrollbar mt-3 flex gap-1.5 overflow-x-auto rounded-none border border-[var(--line)] bg-white/85 p-1.5">
            {tabs.map((item) => (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={`flex shrink-0 items-center gap-2 rounded-none px-3 py-2 text-sm font-semibold transition ${
                  tab === item.id
                    ? "bg-[linear-gradient(180deg,#27b27f_0%,#1f9d72_100%)] text-white shadow-[0_10px_24px_rgba(31,157,114,0.2)]"
                    : "text-[var(--muted)] hover:bg-[var(--bg-soft)] hover:text-[var(--text)]"
                }`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {error && <div className="mt-3 rounded-none border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</div>}

      <div className="mt-4 grid gap-4">

        {tab === "queue" && (
          <Section title="Next Matchups" action={<Pill tone="green">{queuedMatchups.length ? `${queuedMatchups.length} queued` : "waiting pool"}</Pill>}>
            <div className="space-y-4">
              {queuedMatchups.length ? (
                <div className="space-y-3">
                  {queuedMatchups.map((matchup, index) => (
                    <QueuedMatchCard
                      key={`${matchup.teamA.map((player) => player.id).join("-")}-${index}`}
                      matchup={matchup}
                      draft={queueDrafts[index]}
                      order={index + 1}
                      priority={index === 0}
                      lockedBeforeIds={queueDrafts.slice(0, index).flatMap((draft) => [...draft.teamAIds, ...draft.teamBIds])}
                      waitingPlayers={matchmakingWaiting}
                      relationships={matchmakingRelationships}
                      sessionConfig={matchmakingConfig}
                      waitingPlayerMap={waitingPlayerMap}
                      onEditToggle={() => toggleQueueEditing(index)}
                      onChangePlayer={(team, slot, playerId) => updateQueueDraft(index, team, slot, playerId)}
                      onGame={() => void startQueuedMatch(index)}
                      busy={busyAction === "startQueued" && queuedStartingIndex === index}
                    />
                  ))}
                </div>
              ) : (
                <Empty text="Not enough waiting players yet to build the next matchup queue." />
              )}
            </div>
          </Section>
        )}

        {tab === "courts" && (
          <Section title="Court Assignments" action={<Pill tone={activeMatches.length < session.courtCount ? "green" : "blue"}>{activeMatches.length}/{session.courtCount} active</Pill>}>
            <div className="grid gap-3 md:grid-cols-2">
              {activeMatches.map((match) => (
                <MatchBox
                  key={match.id}
                  match={match}
                  pendingResult={pendingResults[match.id]}
                  busy={pendingMatchId === match.id}
                  onPickResult={(result) => setPendingResults((current) => ({ ...current, [match.id]: result }))}
                  onFinish={finish}
                  onCancel={cancelMatch}
                />
              ))}
              {activeMatches.length === 0 && <Empty text="No active matches. Generate the next match when a court opens." />}
            </div>
          </Section>
        )}

        {tab === "summary" && (
          <Section title="Summary" action={<Pill tone="blue">{summaryRows.length} players</Pill>}>
            <SummaryTable
              rows={summaryRows}
              sort={summarySort}
              onSort={(key) =>
                setSummarySort((current) => ({
                  key,
                  direction: current.key === key && current.direction === "desc" ? "asc" : "desc",
                }))
              }
            />
          </Section>
        )}

        {tab === "players" && (
          <div className="space-y-4">
            <nav className="no-scrollbar flex gap-1.5 overflow-x-auto rounded-none border border-[var(--line)] bg-white/85 p-1.5">
              <button
                onClick={() => setPlayersSubTab("list")}
                className={`flex shrink-0 items-center gap-2 rounded-none px-3 py-2 text-sm font-semibold transition ${
                  playersSubTab === "list"
                    ? "bg-[linear-gradient(180deg,#27b27f_0%,#1f9d72_100%)] text-white shadow-[0_10px_24px_rgba(31,157,114,0.2)]"
                    : "text-[var(--muted)] hover:bg-[var(--bg-soft)] hover:text-[var(--text)]"
                }`}
              >
                <Users size={15} />
                Players List
              </button>
              <button
                onClick={() => setPlayersSubTab("check-in")}
                className={`flex shrink-0 items-center gap-2 rounded-none px-3 py-2 text-sm font-semibold transition ${
                  playersSubTab === "check-in"
                    ? "bg-[linear-gradient(180deg,#27b27f_0%,#1f9d72_100%)] text-white shadow-[0_10px_24px_rgba(31,157,114,0.2)]"
                    : "text-[var(--muted)] hover:bg-[var(--bg-soft)] hover:text-[var(--text)]"
                }`}
              >
                <Plus size={15} />
                Player Check-in
              </button>
            </nav>

            {playersSubTab === "list" && (
              <Section title="All Players" action={<Pill tone="slate">{session.players.length} listed</Pill>}>
                <PlayerTable
                  players={session.players}
                  onSelectPlayer={(playerId) => setSelectedPlayerId(playerId)}
                  actions={(player) => (
                    <>
                      {player.status !== "WAITING" && player.status !== "PLAYING" && (
                        <Button variant="soft" onClick={() => updatePlayer(player.id, "WAITING")} loading={pendingPlayerId === player.id}>
                          <TimerReset size={14} />
                          Return
                        </Button>
                      )}
                      {player.status === "WAITING" && (
                        <Button variant="soft" onClick={() => updatePlayer(player.id, "RESTING")} loading={pendingPlayerId === player.id}>
                          <Coffee size={14} />
                          Rest
                        </Button>
                      )}
                      {player.status !== "LEFT" && player.status !== "PLAYING" && (
                        <Button variant="danger" onClick={() => updatePlayer(player.id, "LEFT")} loading={pendingPlayerId === player.id}>
                          <LogOut size={14} />
                          Left
                        </Button>
                      )}
                    </>
                  )}
                />
              </Section>
            )}

            {playersSubTab === "check-in" && (
              <Section title="Player Check-in" action={<Pill tone="amber">joins waiting</Pill>}>
                <div className="space-y-4">
                  <div className="rounded-none border border-[var(--line)] bg-[linear-gradient(180deg,rgba(255,255,255,0.94)_0%,rgba(243,248,201,0.35)_100%)] p-3.5">
                    <div className="grid gap-3">
                      <Field label="Names">
                        <Textarea rows={5} value={names} onChange={(e) => setNames(e.target.value)} placeholder={"One player per line\nMika\nPaolo\nDani"} />
                      </Field>
                      <Field label="Skill">
                        <Select value={skillLevel} onChange={(e) => setSkillLevel(e.target.value)}>
                          <option value="BEGINNER">Beginner</option>
                          <option value="INTERMEDIATE">Intermediate</option>
                          <option value="ADVANCED">Advanced</option>
                        </Select>
                      </Field>
                    </div>
                  </div>

                  <div className="rounded-none border border-dashed border-[var(--line-strong)] bg-[var(--bg-soft)] px-3.5 py-3 text-sm text-[var(--muted)]">
                    Late arrivals drop straight into the waiting lane so the next match still stays fair.
                  </div>

                  <Button onClick={addPlayers} disabled={busyAction !== null} loading={busyAction === "addPlayers"} className="w-full">
                    <Plus size={16} />
                    Add players
                  </Button>
                </div>
              </Section>
            )}
          </div>
        )}

        {tab === "history" && (
          <Section title="Match History" action={<Pill tone="purple">{session.matches.filter((match) => match.status === "FINISHED").length} done</Pill>}>
            <div className="space-y-3">
              {session.matches.filter((match) => match.status === "FINISHED").map((match) => <MatchSummary key={match.id} match={match} />)}
              {!session.matches.filter((match) => match.status === "FINISHED").length && <Empty text="Finished matches will settle here once courts wrap up." />}
            </div>
          </Section>
        )}

        {tab === "settings" && (
          <Section title="Session Settings" action={<Pill tone="slate">live</Pill>}>
            <form action={saveSettings} className="grid gap-4 sm:max-w-md">
              <Field label="Session name">
                <Input name="name" defaultValue={session.name} />
              </Field>
              <Field label="Court count">
                <Input name="courtCount" type="number" min={1} max={12} defaultValue={session.courtCount} />
              </Field>
              <Field label="Rotation mode">
                <Select name="rotationMode" defaultValue={session.rotationMode}>
                  <option value="FAIR_ROTATION">Fair Rotation</option>
                  <option value="SKILL_BALANCED">Skill Balanced</option>
                  <option value="WINNER_STAYS">Winner Stays</option>
                  <option value="LOCKED_PAIRS">Locked Pairs</option>
                </Select>
              </Field>
              <label className="flex items-center gap-2 rounded-none border border-[var(--line)] bg-white/70 px-3.5 py-3 text-sm font-semibold text-[var(--text)]">
                <input name="skillBalancing" type="checkbox" defaultChecked={session.skillBalancing} />
                Skill balancing
              </label>
              <Button loading={savingSettings}>Save settings</Button>
            </form>
          </Section>
        )}
      </div>

      {session && selectedPlayer && (
        <PlayerDetailsSheet
          player={selectedPlayer}
          matches={session.matches}
          onClose={() => setSelectedPlayerId(null)}
        />
      )}
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

function TopMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "amber" | "blue" | "green" | "slate";
}) {
  const tones = {
    amber: "bg-lime-50 text-lime-700",
    blue: "bg-sky-50 text-sky-700",
    green: "bg-emerald-50 text-emerald-700",
    slate: "bg-slate-100 text-slate-700",
  } as const;

  return (
    <div className={`rounded-none border border-white/70 px-2 py-2 shadow-[0_10px_20px_rgba(18,41,28,0.05)] sm:px-3 sm:py-2.5 ${tones[tone]}`}>
      <div className="text-base font-black sm:text-lg">{value}</div>
      <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] sm:text-[11px] sm:tracking-[0.07em]">{label}</div>
    </div>
  );
}

function SummaryTable({
  rows,
  sort,
  onSort,
}: {
  rows: { id: string; name: string; games: number; wins: number; losses: number }[];
  sort: { key: SummarySortKey; direction: "asc" | "desc" };
  onSort: (key: SummarySortKey) => void;
}) {
  if (!rows.length) return <Empty text="No players yet." />;

  return (
    <div className="overflow-hidden rounded-none border border-[var(--line)] bg-white/80">
      <div className="grid grid-cols-[1fr_44px_44px_44px] gap-2 border-b border-[var(--line)] bg-[var(--bg-soft)] px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--muted)]">
        <span>Player</span>
        <SummarySortButton label="G" sortKey="games" sort={sort} onSort={onSort} />
        <SummarySortButton label="W" sortKey="wins" sort={sort} onSort={onSort} />
        <SummarySortButton label="L" sortKey="losses" sort={sort} onSort={onSort} />
      </div>
      <div className="divide-y divide-[var(--line)]">
        {rows.map((row) => (
          <div key={row.id} className="grid grid-cols-[1fr_44px_44px_44px] gap-2 px-4 py-3 text-sm">
            <span className="truncate font-black text-[var(--text)]">{row.name}</span>
            <span className="text-center font-semibold text-[var(--muted)]">{row.games}</span>
            <span className="text-center font-semibold text-emerald-700">{row.wins}</span>
            <span className="text-center font-semibold text-rose-600">{row.losses}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SummarySortButton({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: SummarySortKey;
  sort: { key: SummarySortKey; direction: "asc" | "desc" };
  onSort: (key: SummarySortKey) => void;
}) {
  const active = sort.key === sortKey;

  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={`flex items-center justify-center gap-0.5 text-center ${active ? "text-[var(--text)]" : "text-[var(--muted)]"}`}
    >
      <span>{label}</span>
      <span className="flex flex-col leading-none">
        <ChevronUp size={10} className={active && sort.direction === "asc" ? "text-[var(--text)]" : "text-[var(--muted)]/50"} />
        <ChevronDown size={10} className={active && sort.direction === "desc" ? "text-[var(--text)]" : "text-[var(--muted)]/50"} />
      </span>
    </button>
  );
}

function PlayerTable({
  players,
  actions,
  onSelectPlayer,
}: {
  players: Player[];
  actions: (player: Player) => React.ReactNode;
  onSelectPlayer: (playerId: string) => void;
}) {
  if (!players.length) return <Empty text="No players here." />;

  return (
    <div className="overflow-hidden rounded-none border border-[var(--line)] bg-white/80">
      <div className="divide-y divide-[var(--line)]">
        {players.map((player) => (
          <button
            key={player.id}
            type="button"
            onClick={() => onSelectPlayer(player.id)}
            className="grid w-full gap-3 px-4 py-3.5 text-left transition hover:bg-white/70 sm:grid-cols-[1fr_auto] sm:items-center"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <strong className="truncate text-sm font-black text-[var(--text)]">{player.name}</strong>
                <Pill tone={statusTone[player.status]}>{player.status.toLowerCase()}</Pill>
                <Pill>{skillLabel[player.skillLevel]}</Pill>
              </div>
              <div className="mt-1 flex flex-wrap gap-3 text-xs font-medium text-[var(--muted)]">
                <span>{player.gamesPlayed} games played</span>
                <span>Waiting since {new Date(player.waitStartedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2" onClick={(event) => event.stopPropagation()}>{actions(player)}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function MatchBox({
  match,
  pendingResult,
  busy,
  onPickResult,
  onFinish,
  onCancel,
}: {
  match: Match;
  pendingResult?: "A" | "B" | "DRAW";
  busy: boolean;
  onPickResult: (result: "A" | "B" | "DRAW") => void;
  onFinish: (matchId: string, result: "A" | "B" | "DRAW") => void;
  onCancel: (matchId: string) => void;
}) {
  const teamAPlayers = match.players.filter((player) => player.team === "A").map((player) => player.player.name);
  const teamBPlayers = match.players.filter((player) => player.team === "B").map((player) => player.player.name);

  return (
    <div className="pickleball-court court-shell overflow-hidden shadow-[0_16px_32px_rgba(18,41,28,0.12)]">
      <div className="relative z-10 flex items-center justify-between gap-3 px-3.5 pb-2 pt-3">
        <div>
          <strong className="text-sm font-black text-white drop-shadow-sm">Court {match.courtNumber}</strong>
          <div className="mt-0.5 text-[10px] font-black uppercase tracking-[0.14em] text-white/76">Live pickleball matchup</div>
        </div>
        <div className="bg-white/18 px-2.5 py-1 text-[11px] font-black text-white ring-1 ring-white/24">Playing</div>
      </div>

      <div className="relative z-10 px-3.5 pb-3">
        <div className="pickleball-court-surface">
          <div className="pickleball-side">
            <div className="pickleball-service">
              <CourtPlayerSlot name={teamAPlayers[0]} />
              <CourtPlayerSlot name={teamAPlayers[1]} />
            </div>
            <div className="pickleball-kitchen" />
          </div>

          <div className="pickleball-net" />

          <div className="pickleball-side team-b">
            <div className="pickleball-kitchen" />
            <div className="pickleball-service">
              <CourtPlayerSlot name={teamBPlayers[0]} />
              <CourtPlayerSlot name={teamBPlayers[1]} />
            </div>
          </div>

        </div>
      </div>

      <div className="relative z-10 space-y-2.5 border-t border-white/32 bg-white/88 px-3.5 pb-3.5 pt-3 backdrop-blur-[1px]">
        <div className="grid grid-cols-2 gap-2">
          <Button variant={pendingResult === "A" ? "primary" : "soft"} onClick={() => onPickResult("A")} disabled={busy}>A wins</Button>
          <Button variant={pendingResult === "B" ? "primary" : "soft"} onClick={() => onPickResult("B")} disabled={busy}>B wins</Button>
          <Button variant={pendingResult === "DRAW" ? "primary" : "soft"} onClick={() => onPickResult("DRAW")} disabled={busy}>Draw</Button>
          <Button variant="danger" onClick={() => onCancel(match.id)} loading={busy}>Cancel</Button>
        </div>
        <Button className="w-full" onClick={() => pendingResult && onFinish(match.id, pendingResult)} disabled={!pendingResult || busy} loading={busy}>
          Done
        </Button>
      </div>
    </div>
  );
}

function CourtPlayerSlot({ name }: { name?: string }) {
  return (
    <div className="flex min-w-0 items-center justify-center p-2">
      <div className="w-full max-w-[150px] px-2.5 py-4 text-center text-[14px] font-black tracking-[0.02em] text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)]">
        <div className="truncate">{name || "Open"}</div>
      </div>
    </div>
  );
}

function MatchSummary({ match }: { match: Match }) {
  const teamA = match.players.filter((player) => player.team === "A").map((player) => player.player.name).join(" + ");
  const teamB = match.players.filter((player) => player.team === "B").map((player) => player.player.name).join(" + ");

  return (
    <div className="rounded-none border border-[var(--line)] bg-white/80 px-4 py-3 shadow-[0_10px_20px_rgba(18,41,28,0.04)]">
      <div className="mb-2 flex items-center justify-between gap-3">
        <strong className="text-sm font-black text-[var(--text)]">Court {match.courtNumber}</strong>
        <Pill tone="green">{match.winningTeam ? `Team ${match.winningTeam} won` : "Draw"}</Pill>
      </div>
      <div className="space-y-2 text-sm">
        <div className="rounded-none border border-sky-100 bg-[var(--match-a)] px-3 py-2 font-semibold text-sky-900">
          Team A: {teamA}
        </div>
        <div className="rounded-none border border-lime-100 bg-[var(--match-b)] px-3 py-2 font-semibold text-lime-900">
          Team B: {teamB}
        </div>
      </div>
    </div>
  );
}

function QueuedMatchCard({
  matchup,
  draft,
  order,
  priority,
  lockedBeforeIds,
  waitingPlayers,
  relationships,
  sessionConfig,
  waitingPlayerMap,
  onEditToggle,
  onChangePlayer,
  onGame,
  busy,
}: {
  matchup: QueuedMatchup;
  draft?: QueueDraft;
  order: number;
  priority: boolean;
  lockedBeforeIds: string[];
  waitingPlayers: MatchmakingWaitingPlayer[];
  relationships: MatchmakingRelationship[];
  sessionConfig: MatchmakingSessionConfig | null;
  waitingPlayerMap: Map<string, Player>;
  onEditToggle: () => void;
  onChangePlayer: (team: "A" | "B", slot: number, playerId: string) => void;
  onGame: () => void;
  busy: boolean;
}) {
  const fallbackDraft = {
    teamAIds: matchup.teamA.map((player) => player.id),
    teamBIds: matchup.teamB.map((player) => player.id),
    editing: false,
  };
  const activeDraft = draft ?? fallbackDraft;
  const selectedIds = [...activeDraft.teamAIds, ...activeDraft.teamBIds];
  const selectedPlayers = selectedIds.map((playerId) => waitingPlayerMap.get(playerId)).filter(Boolean) as Player[];
  const averageGames = selectedPlayers.length
    ? Math.round(selectedPlayers.reduce((sum, player) => sum + player.gamesPlayed, 0) / selectedPlayers.length)
    : Math.round(
        [...matchup.teamA, ...matchup.teamB].reduce((sum, player) => sum + player.gamesPlayed, 0) /
          [...matchup.teamA, ...matchup.teamB].length,
      );

  return (
    <div className={`overflow-hidden border bg-[linear-gradient(180deg,#ffffff_0%,#f7fbf6_100%)] shadow-[0_18px_34px_rgba(18,41,28,0.06)] ${priority ? "border-emerald-500 shadow-[0_18px_34px_rgba(31,157,114,0.12)]" : "border-[var(--line)]"}`}>
      <div className="flex items-start justify-between gap-3 border-b border-[var(--line)] bg-[linear-gradient(90deg,rgba(223,242,255,0.45)_0%,rgba(238,249,208,0.4)_100%)] px-4 py-3">
        <div>
          <strong className="text-sm font-black text-[var(--text)]">Next Match {order}</strong>
          <div className="mt-1 text-xs font-medium text-[var(--muted)]">{priority ? "First in line for the next open court" : "Follows after the earlier queued matches"}</div>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          {priority && <Pill tone="green">first in line</Pill>}
          <Pill tone="blue">avg {averageGames} games</Pill>
          <Pill tone="green">{activeDraft.editing ? "editing" : "ready"}</Pill>
        </div>
      </div>

      <div className="grid gap-3 p-4">
        <QueueTeamBlock
          label="Team A"
          tone="blue"
          playerIds={activeDraft.teamAIds}
          editing={activeDraft.editing}
          team="A"
          selectedIds={selectedIds}
          waitingPlayers={waitingPlayers}
          relationships={relationships}
          sessionConfig={sessionConfig}
          lockedBeforeIds={lockedBeforeIds}
          waitingPlayerMap={waitingPlayerMap}
          oppositeTeamIds={activeDraft.teamBIds}
          onChangePlayer={onChangePlayer}
        />
        <QueueTeamBlock
          label="Team B"
          tone="lime"
          playerIds={activeDraft.teamBIds}
          editing={activeDraft.editing}
          team="B"
          selectedIds={selectedIds}
          waitingPlayers={waitingPlayers}
          relationships={relationships}
          sessionConfig={sessionConfig}
          lockedBeforeIds={lockedBeforeIds}
          waitingPlayerMap={waitingPlayerMap}
          oppositeTeamIds={activeDraft.teamAIds}
          onChangePlayer={onChangePlayer}
        />
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-[var(--line)] bg-white px-4 py-3">
        <Button variant="soft" onClick={onEditToggle}>
          {activeDraft.editing ? "Done editing" : "Edit"}
        </Button>
        <Button onClick={onGame} disabled={busy}>
          <Play size={15} />
          Game
        </Button>
      </div>

      {matchup.reasons.length > 0 && (
        <div className="border-t border-[var(--line)] bg-[var(--bg-soft)] px-4 py-3 text-xs font-medium text-[var(--muted)]">
          Note: {matchup.reasons[0]}
        </div>
      )}
    </div>
  );
}

function QueueTeamBlock({
  label,
  tone,
  playerIds,
  editing,
  team,
  selectedIds,
  waitingPlayers,
  relationships,
  sessionConfig,
  lockedBeforeIds,
  waitingPlayerMap,
  oppositeTeamIds,
  onChangePlayer,
}: {
  label: string;
  tone: "blue" | "lime";
  playerIds: string[];
  editing: boolean;
  team: "A" | "B";
  selectedIds: string[];
  waitingPlayers: MatchmakingWaitingPlayer[];
  relationships: MatchmakingRelationship[];
  sessionConfig: MatchmakingSessionConfig | null;
  lockedBeforeIds: string[];
  waitingPlayerMap: Map<string, Player>;
  oppositeTeamIds: string[];
  onChangePlayer: (team: "A" | "B", slot: number, playerId: string) => void;
}) {
  const styles = {
    blue: {
      wrap: "border-sky-100 bg-[linear-gradient(180deg,#e8f5ff_0%,#d7ecff_100%)]",
      label: "text-sky-800",
      text: "text-sky-950",
    },
    lime: {
      wrap: "border-lime-100 bg-[linear-gradient(180deg,#f0f8cf_0%,#e5f39f_100%)]",
      label: "text-lime-800",
      text: "text-lime-950",
    },
  } as const;

  return (
    <div className={`border px-3 py-3 ${styles[tone].wrap}`}>
      <div className={`mb-2 text-[11px] font-black uppercase tracking-[0.12em] ${styles[tone].label}`}>{label}</div>
      <div className="grid gap-2 sm:grid-cols-2">
        {playerIds.map((playerId, slot) => {
          const currentPlayer = waitingPlayerMap.get(playerId);
          const options = getRankedSlotOptions({
            currentPlayerId: playerId,
            team,
            slot,
            playerIds,
            oppositeTeamIds,
            selectedIds,
            lockedBeforeIds,
            waitingPlayers,
            relationships,
            sessionConfig,
          });

          return editing ? (
            <Select key={`${team}-${slot}`} value={playerId} onChange={(event) => onChangePlayer(team, slot, event.target.value)} className={`px-3 py-3 font-bold ${styles[tone].text}`}>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name} ({option.gamesPlayed} games played)
                </option>
              ))}
            </Select>
          ) : (
            <div key={`${team}-${slot}`} className={`border border-white/70 bg-white/72 px-3 py-3 text-sm font-black shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] ${styles[tone].text}`}>
              {currentPlayer ? `${currentPlayer.name} (${currentPlayer.gamesPlayed} games played)` : "Open"}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function getRankedSlotOptions(params: {
  currentPlayerId: string;
  team: "A" | "B";
  slot: number;
  playerIds: string[];
  oppositeTeamIds: string[];
  selectedIds: string[];
  lockedBeforeIds: string[];
  waitingPlayers: MatchmakingWaitingPlayer[];
  relationships: MatchmakingRelationship[];
  sessionConfig: MatchmakingSessionConfig | null;
}) {
  const othersSelected = new Set([...params.lockedBeforeIds, ...params.selectedIds.filter((id) => id !== params.currentPlayerId)]);
  const currentPlayer = params.waitingPlayers.find((player) => player.id === params.currentPlayerId);
  const candidatePool = params.waitingPlayers.filter((player) => !othersSelected.has(player.id));
  const currentOption = currentPlayer ? [currentPlayer] : [];

  const ranked = candidatePool
    .filter((player) => player.id !== params.currentPlayerId)
    .map((player) => {
      const nextTeamIds = [...params.playerIds];
      nextTeamIds[params.slot] = player.id;
      const teamAIds = params.team === "A" ? nextTeamIds : params.oppositeTeamIds;
      const teamBIds = params.team === "B" ? nextTeamIds : params.oppositeTeamIds;
      const teamA = teamAIds
        .map((playerId) => params.waitingPlayers.find((waitingPlayer) => waitingPlayer.id === playerId))
        .filter(Boolean) as MatchmakingWaitingPlayer[];
      const teamB = teamBIds
        .map((playerId) => params.waitingPlayers.find((waitingPlayer) => waitingPlayer.id === playerId))
        .filter(Boolean) as MatchmakingWaitingPlayer[];

      const score = params.sessionConfig
        ? evaluateMatchup({
            session: params.sessionConfig,
            teamA,
            teamB,
            waitingPlayers: params.waitingPlayers,
            relationships: params.relationships,
            now: new Date(),
          }).score
        : Number.MAX_SAFE_INTEGER;

      return { ...player, fitScore: score };
    })
    .sort((a, b) => a.fitScore - b.fitScore || a.waitStartedAt.getTime() - b.waitStartedAt.getTime() || a.gamesPlayed - b.gamesPlayed || a.name.localeCompare(b.name));

  return [...currentOption, ...ranked];
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-none border border-dashed border-[var(--line-strong)] bg-[var(--bg-soft)] px-4 py-10 text-center text-sm font-medium text-[var(--muted)]">
      {text}
    </div>
  );
}

function PlayerDetailsSheet({
  player,
  matches,
  onClose,
}: {
  player: Player;
  matches: Match[];
  onClose: () => void;
}) {
  const playerMatches = matches
    .filter((match) => match.players.some((entry) => entry.player.id === player.id))
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

  const teammateCounts = new Map<string, number>();
  const opponentCounts = new Map<string, number>();
  let wins = 0;
  let losses = 0;
  let draws = 0;
  let live = 0;

  for (const match of playerMatches) {
    const current = match.players.find((entry) => entry.player.id === player.id);
    if (!current) continue;
    const teammates = match.players.filter((entry) => entry.team === current.team && entry.player.id !== player.id).map((entry) => entry.player.name);
    const opponents = match.players.filter((entry) => entry.team !== current.team).map((entry) => entry.player.name);

    if (match.status === "ACTIVE") live++;
    else if (current.result === "WIN") wins++;
    else if (current.result === "LOSS") losses++;
    else draws++;

    for (const teammate of teammates) {
      teammateCounts.set(teammate, (teammateCounts.get(teammate) ?? 0) + 1);
    }
    for (const opponent of opponents) {
      opponentCounts.set(opponent, (opponentCounts.get(opponent) ?? 0) + 1);
    }
  }

  const allPartners = [...teammateCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const allOpponents = [...opponentCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const partnerLine = allPartners.length ? allPartners.map(([name, count]) => `${name} (${count}x)`).join(", ") : "No partners yet";
  const opponentLine = allOpponents.length ? allOpponents.map(([name, count]) => `${name} (${count}x)`).join(", ") : "No opponents yet";
  const recordLine = `${wins}W • ${losses}L • ${draws}D${live ? ` • ${live} live` : ""}`;

  return (
    <div className="fixed inset-0 z-40 flex items-end bg-[rgba(17,24,39,0.18)] p-0 sm:items-center sm:justify-center sm:p-6" onClick={onClose}>
      <div
        className="max-h-[88vh] w-full overflow-hidden rounded-none border border-[var(--line)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(244,248,241,0.96)_100%)] shadow-[0_24px_60px_rgba(18,41,28,0.18)] sm:max-w-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--line)] px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-base font-black text-[var(--text)]">{player.name}</h3>
              <Pill tone={statusTone[player.status]}>{player.status.toLowerCase()}</Pill>
              <Pill>{skillLabel[player.skillLevel]}</Pill>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Pill tone="blue">{player.gamesPlayed} games</Pill>
              <Pill tone="green">{playerMatches.length} match logs</Pill>
            </div>
          </div>
          <Button variant="soft" onClick={onClose}>Close</Button>
        </div>

        <div className="grid max-h-[calc(88vh-88px)] gap-4 overflow-y-auto px-4 py-4 sm:px-5 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-4">
            <Section title="Snapshot" action={<Pill tone="slate">{playerMatches.length} logs</Pill>}>
              <div className="space-y-3">
                <div className="rounded-none border border-emerald-100 bg-emerald-50/80 px-3 py-3">
                  <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-emerald-700">Record</div>
                  <div className="mt-1 text-sm font-black text-emerald-950">{recordLine}</div>
                </div>
                <div className="rounded-none border border-sky-100 bg-sky-50/75 px-3 py-3">
                  <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-sky-700">Partners</div>
                  <div className="mt-1 text-sm font-semibold leading-6 text-sky-950">{partnerLine}</div>
                </div>
                <div className="rounded-none border border-lime-100 bg-lime-50/75 px-3 py-3">
                  <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-lime-700">Most faced</div>
                  <div className="mt-1 text-sm font-semibold leading-6 text-lime-950">{opponentLine}</div>
                </div>
              </div>
            </Section>
          </div>

          <div className="space-y-4">
            <Section title="All Games" action={<Pill tone="slate">{playerMatches.length} total</Pill>}>
              <div className="space-y-3">
                {playerMatches.length ? playerMatches.map((match) => {
                  const current = match.players.find((entry) => entry.player.id === player.id)!;
                  const teammates = match.players.filter((entry) => entry.team === current.team).map((entry) => entry.player.name).join(" + ");
                  const opponents = match.players.filter((entry) => entry.team !== current.team).map((entry) => entry.player.name).join(" + ");
                  const resultLabel =
                    match.status === "ACTIVE"
                      ? "Live"
                      : current.result === "WIN"
                        ? "Win"
                        : current.result === "LOSS"
                          ? "Loss"
                          : "Draw";
                  const resultTone =
                    resultLabel === "Win"
                      ? "border-emerald-200 bg-emerald-50/60"
                      : resultLabel === "Loss"
                        ? "border-red-200 bg-red-50/60"
                        : resultLabel === "Live"
                          ? "border-sky-200 bg-sky-50/60"
                          : "border-slate-200 bg-slate-50/70";
                  const ResultIcon =
                    resultLabel === "Win" ? CheckCircle2 : resultLabel === "Loss" ? XCircle : resultLabel === "Draw" ? Equal : Zap;
                  const resultTextTone =
                    resultLabel === "Win"
                      ? "text-emerald-700"
                      : resultLabel === "Loss"
                        ? "text-red-700"
                        : resultLabel === "Live"
                          ? "text-sky-700"
                          : "text-slate-700";

                  return (
                    <div key={match.id} className={`rounded-none border px-3.5 py-3 ${resultTone}`}>
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <strong className="text-sm font-black text-[var(--text)]">Court {match.courtNumber}</strong>
                        <div className={`inline-flex items-center gap-1.5 rounded-none bg-white/90 px-2.5 py-1 text-xs font-bold ${resultTextTone}`}>
                          <ResultIcon size={14} />
                          {resultLabel}
                        </div>
                      </div>
                      <div className="space-y-2 text-sm">
                        <div className="rounded-none border border-sky-100 bg-[var(--match-a)] px-3 py-2 font-semibold text-sky-900">
                          Team {current.team}: {teammates}
                        </div>
                        <div className="rounded-none border border-lime-100 bg-[var(--match-b)] px-3 py-2 font-semibold text-lime-900">
                          Opponents: {opponents}
                        </div>
                      </div>
                    </div>
                  );
                }) : <Empty text="No games yet." />}
              </div>
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}
