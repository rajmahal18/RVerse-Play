"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Clock3,
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
  UserPlus,
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
  leftAt?: string | null;
};
type MatchPlayer = { id: string; team: "A" | "B"; result: string; player: Player };
type Match = { id: string; courtNumber: number; status: "ACTIVE" | "FINISHED"; startedAt: string; endedAt?: string | null; winningTeam?: "A" | "B" | null; players: MatchPlayer[] };
type Relationship = { id: string; playerAId: string; playerBId: string; partnerCount: number; opponentCount: number; lockedPair?: boolean; lastPartnerAt?: string | null };
type PlayerLog = {
  id: string;
  sessionId: string;
  playerId: string;
  matchId?: string | null;
  type: "ARRIVED" | "RESTED" | "MATCH_STARTED" | "MATCH_WON" | "MATCH_LOST" | "MATCH_DRAW" | "MATCH_CANCELED" | "LEFT" | "RETURNED";
  message?: string | null;
  createdAt: string;
};
type Session = {
  id: string;
  name: string;
  joinCode: string | null;
  courtCount: number;
  rotationMode: string;
  skillBalancing: boolean;
  status: "ACTIVE" | "ENDED";
  endedAt?: string | null;
  viewerCanManage: boolean;
  viewerPlayer?: Player | null;
  players: Player[];
  matches: Match[];
  relationships: Relationship[];
  playerLogs: PlayerLog[];
};
type PreviewPlayer = Pick<Player, "id" | "name" | "skillLevel" | "gamesPlayed">;
type QueuedMatchup = { teamA: PreviewPlayer[]; teamB: PreviewPlayer[]; score: number; reasons: string[] };
type QueueDraft = { teamAIds: string[]; teamBIds: string[]; editing: boolean };
type PairDraft = { playerAId: string; playerBId: string; suggested?: boolean };
type Tab = "queue" | "courts" | "summary" | "players" | "pairing" | "history" | "settings";
type SummarySortKey = "games" | "wins" | "losses";
type PlayerDetailsTab = "matchups" | "results" | "logs";

const statusTone = { WAITING: "amber", PLAYING: "blue", RESTING: "slate", LEFT: "red" } as const;
const skillLabel = { BEGINNER: "Beginner", INTERMEDIATE: "Intermediate", ADVANCED: "Advanced" };

function formatClockTime(value?: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function getPlayerStatusTimeLabel(player: Player) {
  if (player.status === "WAITING") return `Waiting since ${formatClockTime(player.waitStartedAt)}`;
  if (player.status === "PLAYING") return "Now playing";
  if (player.status === "RESTING") return "Resting";
  if (player.status === "LEFT") return player.leftAt ? `Left ${formatClockTime(player.leftAt)}` : "Left";
  return "";
}

function sortPairingPlayers(players: Player[]) {
  return [...players].sort(
    (a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
      new Date(a.waitStartedAt).getTime() - new Date(b.waitStartedAt).getTime() ||
      a.name.localeCompare(b.name),
  );
}

function buildPairDrafts(players: Player[], configuredPairs: Relationship[]) {
  const drafts = configuredPairs.map((pair) => ({ playerAId: pair.playerAId, playerBId: pair.playerBId, suggested: false }));
  const pairedIds = new Set(drafts.flatMap((pair) => [pair.playerAId, pair.playerBId]));
  const unpairedPlayers = sortPairingPlayers(players.filter((player) => player.status !== "LEFT" && !pairedIds.has(player.id)));

  for (let index = 0; index + 1 < unpairedPlayers.length; index += 2) {
    drafts.push({ playerAId: unpairedPlayers[index].id, playerBId: unpairedPlayers[index + 1].id, suggested: true });
  }

  return drafts;
}

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
  const [endingSession, setEndingSession] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [queuedStartingIndex, setQueuedStartingIndex] = useState<number | null>(null);
  const [savingPairs, setSavingPairs] = useState(false);
  const [pairDrafts, setPairDrafts] = useState<PairDraft[]>([]);
  const [pairDraftsDirty, setPairDraftsDirty] = useState(false);
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
    const data = await res.json();
    if (!res.ok) {
      setError(data?.error || "Could not open session.");
      return;
    }
    setSession(data);
  }

  useEffect(() => {
    void load();
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    const interval = window.setInterval(() => {
      void load(sessionId);
    }, 5000);
    return () => window.clearInterval(interval);
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
  const activePlayers = useMemo(() => session?.players.filter((player) => player.status !== "LEFT") ?? [], [session]);
  const configuredPairs = useMemo(
    () => session?.relationships.filter((relationship) => relationship.lockedPair) ?? [],
    [session],
  );
  const savedPairedPlayerIds = useMemo(() => new Set(configuredPairs.flatMap((pair) => [pair.playerAId, pair.playerBId])), [configuredPairs]);
  const waitingUnpairedCount = useMemo(() => waiting.filter((player) => !savedPairedPlayerIds.has(player.id)).length, [savedPairedPlayerIds, waiting]);

  useEffect(() => {
    if (!session) return;
    if (pairDraftsDirty) return;
    setPairDrafts(buildPairDrafts(activePlayers, configuredPairs));
  }, [activePlayers, configuredPairs, pairDraftsDirty, session]);
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
  const canManage = session?.viewerCanManage ?? false;

  useEffect(() => {
    if (!sessionId || canManage || !session?.viewerPlayer) return;

    const releasePlayer = () => {
      if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
        navigator.sendBeacon(`/api/sessions/${sessionId}/leave`, new Blob([], { type: "application/json" }));
        return;
      }

      void fetch(`/api/sessions/${sessionId}/leave`, {
        method: "POST",
        keepalive: true,
      });
    };

    window.addEventListener("pagehide", releasePlayer);
    return () => {
      window.removeEventListener("pagehide", releasePlayer);
    };
  }, [canManage, session?.viewerPlayer, sessionId]);

  async function addPlayers() {
    if (!session?.viewerCanManage) return;
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
    if (!session?.viewerCanManage) return;
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
    if (!session?.viewerCanManage) return;
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
    if (!session?.viewerCanManage) return;
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

  function addPairDraft() {
    const used = new Set(pairDrafts.flatMap((pair) => [pair.playerAId, pair.playerBId]).filter(Boolean));
    const available = sortPairingPlayers(activePlayers.filter((player) => !used.has(player.id)));
    setPairDraftsDirty(true);
    setPairDrafts((current) => [...current, { playerAId: available[0]?.id || "", playerBId: available[1]?.id || "", suggested: true }]);
  }

  function updatePairDraft(index: number, field: "playerAId" | "playerBId", playerId: string) {
    setPairDraftsDirty(true);
    setPairDrafts((current) => current.map((pair, pairIndex) => (pairIndex === index ? { ...pair, [field]: playerId, suggested: false } : pair)));
  }

  function removePairDraft(index: number) {
    setPairDraftsDirty(true);
    setPairDrafts((current) => current.filter((_, pairIndex) => pairIndex !== index));
  }

  async function savePairs() {
    if (!session?.viewerCanManage) return;
    setSavingPairs(true);
    setError("");
    const pairs = pairDrafts.filter((pair) => pair.playerAId && pair.playerBId && pair.playerAId !== pair.playerBId);
    const res = await fetch(`/api/sessions/${sessionId}/pairs`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pairs }),
    });
    const data = await readJsonSafe(res);
    if (!res.ok) setError(data?.error || "Could not save locked pairs.");
    else setPairDraftsDirty(false);
    setSavingPairs(false);
    void load();
  }

  async function finish(matchId: string, result: "A" | "B" | "DRAW") {
    if (!session?.viewerCanManage) return;
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
    if (!session?.viewerCanManage) return;
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
    if (!session?.viewerCanManage) return;
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

  async function endSession() {
    if (!session?.viewerCanManage) return;
    if (!window.confirm("End this session?")) return;
    setEndingSession(true);
    const res = await fetch(`/api/sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "end" }),
    });
    const data = await readJsonSafe(res);
    if (!res.ok) setError(data?.error || "Could not end session.");
    setEndingSession(false);
    void load();
  }

  async function copyJoinCode() {
    if (!session?.joinCode) return;
    await navigator.clipboard.writeText(session.joinCode);
    setCopiedCode(true);
    window.setTimeout(() => setCopiedCode(false), 1400);
  }

  if (!session) return <div className="p-6 text-sm text-[var(--muted)]">{error || "Loading..."}</div>;
  const sessionEnded = session.status === "ENDED";

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "queue", label: "Queue", icon: <ListOrdered size={15} /> },
    { id: "courts", label: "Courts", icon: <Play size={15} /> },
    { id: "players", label: "Players", icon: <Users size={15} /> },
    ...(canManage ? [{ id: "pairing" as const, label: "Pairing", icon: <UserPlus size={15} /> }] : []),
    { id: "history", label: "History", icon: <History size={15} /> },
    { id: "summary", label: "Summary", icon: <Equal size={15} /> },
    ...(canManage ? [{ id: "settings" as const, label: "Settings", icon: <Settings size={15} /> }] : []),
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
                  <Pill tone={sessionEnded ? "slate" : "green"}>{sessionEnded ? "Ended" : gameStats.label}</Pill>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Pill tone="blue">{session.courtCount} courts</Pill>
                  <Pill tone="amber">{waiting.length} waiting</Pill>
                  <Pill tone="purple">{session.rotationMode.replaceAll("_", " ").toLowerCase()}</Pill>
                </div>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              {canManage && !sessionEnded && (
                <Button onClick={generate} disabled={busyAction !== null} loading={busyAction === "generate"}>
                  <Shuffle size={16} />
                  <span className="hidden sm:inline">Generate match</span>
                </Button>
              )}
              {canManage && !sessionEnded && (
                <Button variant="danger" onClick={endSession} loading={endingSession}>
                  <XCircle size={16} />
                  <span className="hidden sm:inline">End session</span>
                </Button>
              )}
            </div>
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

        {sessionEnded && <div className="rounded-none border border-[var(--line)] bg-white/80 px-3 py-2 text-sm font-semibold text-[var(--muted)]">This session has ended.</div>}
        {!canManage && session.viewerPlayer && (
          <div className="rounded-none border border-[var(--line)] bg-white/80 px-3 py-2 text-sm font-semibold text-[var(--text)]">
            You joined this session as {session.viewerPlayer.name}.
          </div>
        )}

        {tab === "queue" && (
          <Section title="Next Matchups" action={<Pill tone="green">{queuedMatchups.length ? `${queuedMatchups.length} queued` : "waiting pool"}</Pill>}>
            <div className="space-y-4">
              {session.rotationMode === "LOCKED_PAIRS" && waitingUnpairedCount > 0 && (
                <div className="border border-amber-100 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
                  {waitingUnpairedCount} waiting player{waitingUnpairedCount === 1 ? "" : "s"} need saved pairs before they can be queued.
                </div>
              )}
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
                      disabled={sessionEnded || !canManage}
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
                  disabled={sessionEnded || !canManage}
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
            {canManage && <nav className="no-scrollbar flex gap-1.5 overflow-x-auto rounded-none border border-[var(--line)] bg-white/85 p-1.5">
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
            </nav>}

            {playersSubTab === "list" && (
              <Section title="All Players" action={<Pill tone="slate">{session.players.length} listed</Pill>}>
                <PlayerTable
                  players={session.players}
                  onSelectPlayer={(playerId) => setSelectedPlayerId(playerId)}
                  actions={(player) => canManage ? (
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
                  ) : null}
                />
              </Section>
            )}

            {canManage && playersSubTab === "check-in" && (
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

        {canManage && tab === "pairing" && (
          <PairingPanel
            players={activePlayers}
            pairDrafts={pairDrafts}
            saving={savingPairs}
            onAddPair={addPairDraft}
            onUpdatePair={updatePairDraft}
            onRemovePair={removePairDraft}
            onSave={savePairs}
          />
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
            <div className="grid gap-4 sm:max-w-md">
              {session.joinCode && (
                <div className="grid gap-1.5">
                  <span className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted)]">Session code</span>
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <Input value={session.joinCode} readOnly />
                    <Button type="button" variant="soft" onClick={copyJoinCode}>
                      {copiedCode ? "Copied" : "Copy"}
                    </Button>
                  </div>
                </div>
              )}
              <form action={saveSettings} className="grid gap-4">
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
            </div>
          </Section>
        )}
      </div>

      {session && selectedPlayer && (
        <PlayerDetailsSheet
          player={selectedPlayer}
          matches={session.matches}
          logs={session.playerLogs ?? []}
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
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-[var(--muted)]">
                <span>{player.gamesPlayed} games played</span>
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <Clock3 size={13} className="shrink-0 text-emerald-700" />
                  <span>Arrived {formatClockTime(player.createdAt)}</span>
                </span>
                <span>{getPlayerStatusTimeLabel(player)}</span>
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
  disabled = false,
}: {
  match: Match;
  pendingResult?: "A" | "B" | "DRAW";
  busy: boolean;
  onPickResult: (result: "A" | "B" | "DRAW") => void;
  onFinish: (matchId: string, result: "A" | "B" | "DRAW") => void;
  onCancel: (matchId: string) => void;
  disabled?: boolean;
}) {
  const teamAPlayers = match.players.filter((player) => player.team === "A").map((player) => player.player.name);
  const teamBPlayers = match.players.filter((player) => player.team === "B").map((player) => player.player.name);

  return (
    <div className="pickleball-court court-shell overflow-hidden shadow-[0_16px_32px_rgba(18,41,28,0.12)]">
      <div className="relative z-10 flex items-center justify-between gap-3 px-3.5 pb-2 pt-3">
        <div>
          <strong className="text-sm font-black text-white drop-shadow-sm">Court {match.courtNumber}</strong>
          <div className="mt-0.5 text-[10px] font-black uppercase tracking-[0.14em] text-white/76">Active match</div>
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
          <Button variant={pendingResult === "A" ? "primary" : "soft"} onClick={() => onPickResult("A")} disabled={busy || disabled}>A wins</Button>
          <Button variant={pendingResult === "B" ? "primary" : "soft"} onClick={() => onPickResult("B")} disabled={busy || disabled}>B wins</Button>
          <Button variant={pendingResult === "DRAW" ? "primary" : "soft"} onClick={() => onPickResult("DRAW")} disabled={busy || disabled}>Draw</Button>
          <Button variant="danger" onClick={() => onCancel(match.id)} disabled={disabled} loading={busy}>Cancel</Button>
        </div>
        <Button className="w-full" onClick={() => pendingResult && onFinish(match.id, pendingResult)} disabled={!pendingResult || busy || disabled} loading={busy}>
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
  disabled = false,
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
  disabled?: boolean;
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
        <Button variant="soft" onClick={onEditToggle} disabled={disabled}>
          {activeDraft.editing ? "Done editing" : "Edit"}
        </Button>
        <Button onClick={onGame} disabled={busy || disabled}>
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

function PairingPanel({
  players,
  pairDrafts,
  saving,
  onAddPair,
  onUpdatePair,
  onRemovePair,
  onSave,
}: {
  players: Player[];
  pairDrafts: PairDraft[];
  saving: boolean;
  onAddPair: () => void;
  onUpdatePair: (index: number, field: "playerAId" | "playerBId", playerId: string) => void;
  onRemovePair: (index: number) => void;
  onSave: () => void;
}) {
  const usedPlayerIds = pairDrafts.flatMap((pair) => [pair.playerAId, pair.playerBId]).filter(Boolean);
  const usedIds = new Set(usedPlayerIds);
  const duplicateIds = new Set<string>();
  const seen = new Set<string>();
  for (const id of usedPlayerIds) {
    if (seen.has(id)) duplicateIds.add(id);
    seen.add(id);
  }
  const incompletePairs = pairDrafts.filter((pair) => !pair.playerAId || !pair.playerBId || pair.playerAId === pair.playerBId).length;
  const canAddPair = players.filter((player) => !usedIds.has(player.id)).length >= 2;

  return (
    <Section
      title="Pairing"
      action={
        <div className="flex flex-wrap gap-2">
          <Pill tone="purple">{pairDrafts.length} pairs</Pill>
          <Pill tone="slate">{Math.max(0, players.length - usedIds.size)} unpaired</Pill>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold leading-6 text-[var(--muted)]">
            Locked-pairs mode only uses saved pairs. New unpaired players are suggested here by arrival order and must be saved before they can play.
          </div>
          <Button type="button" variant="soft" onClick={onAddPair} disabled={!canAddPair}>
            <Plus size={15} />
            Add pair
          </Button>
        </div>

        {pairDrafts.length ? (
          <div className="divide-y divide-[var(--line)] border border-[var(--line)] bg-white/82">
            {pairDrafts.map((pair, index) => (
              <div key={index} className="grid gap-2 px-3 py-3 sm:grid-cols-[1fr_1fr_auto] sm:items-center">
                <div className="grid gap-1">
                  {pair.suggested && <span className="text-[10px] font-black uppercase tracking-[0.08em] text-amber-700">Suggested</span>}
                  <PairSelect
                    value={pair.playerAId}
                    players={players}
                    usedIds={usedIds}
                    currentPair={pair}
                    placeholder="Player 1"
                    onChange={(playerId) => onUpdatePair(index, "playerAId", playerId)}
                  />
                </div>
                <div className="grid gap-1">
                  {pair.suggested && <span className="text-[10px] font-black uppercase tracking-[0.08em] text-amber-700">Save to lock</span>}
                  <PairSelect
                    value={pair.playerBId}
                    players={players}
                    usedIds={usedIds}
                    currentPair={pair}
                    placeholder="Player 2"
                    onChange={(playerId) => onUpdatePair(index, "playerBId", playerId)}
                  />
                </div>
                <Button type="button" variant="plain" onClick={() => onRemovePair(index)}>
                  <XCircle size={15} />
                  Remove
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <Empty text="No locked pairs configured yet." />
        )}

        {(duplicateIds.size > 0 || incompletePairs > 0) && (
          <div className="border border-red-100 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
            Fix duplicate or incomplete pairs before saving.
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" onClick={onSave} loading={saving} disabled={duplicateIds.size > 0 || incompletePairs > 0}>
            Save pairs
          </Button>
        </div>
      </div>
    </Section>
  );
}

function PairSelect({
  value,
  players,
  usedIds,
  currentPair,
  placeholder,
  onChange,
}: {
  value: string;
  players: Player[];
  usedIds: Set<string>;
  currentPair: PairDraft;
  placeholder: string;
  onChange: (playerId: string) => void;
}) {
  const hasValue = Boolean(value);
  return (
    <Select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={hasValue ? "border-emerald-200 bg-emerald-50/60 font-semibold" : ""}
    >
      <option value="">{placeholder}</option>
      {players.map((player) => {
        const selectedInThisPair = player.id === currentPair.playerAId || player.id === currentPair.playerBId;
        const disabled = usedIds.has(player.id) && !selectedInThisPair;
        const indicator = disabled ? "paired" : selectedInThisPair ? "selected here" : "available";
        return (
          <option key={player.id} value={player.id} disabled={disabled}>
            {player.name} ({player.gamesPlayed} games) - {indicator}
          </option>
        );
      })}
    </Select>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-none border border-dashed border-[var(--line-strong)] bg-[var(--bg-soft)] px-4 py-10 text-center text-sm font-medium text-[var(--muted)]">
      {text}
    </div>
  );
}

function LegacyPlayerDetailsSheet({
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

function PlayerDetailsSheet({
  player,
  matches,
  logs,
  onClose,
}: {
  player: Player;
  matches: Match[];
  logs: PlayerLog[];
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<PlayerDetailsTab>("matchups");
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
    for (const teammate of teammates) teammateCounts.set(teammate, (teammateCounts.get(teammate) ?? 0) + 1);
    for (const opponent of opponents) opponentCounts.set(opponent, (opponentCounts.get(opponent) ?? 0) + 1);
  }

  const allPartners = [...teammateCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const allOpponents = [...opponentCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const playerLogs = buildPlayerLogs({ player, matches: playerMatches, logs });
  const recordLine = `${wins}W - ${losses}L - ${draws}D${live ? ` - ${live} live` : ""}`;
  const tabs: { id: PlayerDetailsTab; label: string; count: number }[] = [
    { id: "matchups", label: "Matchups", count: allPartners.length + allOpponents.length },
    { id: "results", label: "Results", count: playerMatches.length },
    { id: "logs", label: "Logs", count: playerLogs.length },
  ];

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
              <Pill tone="green">{playerLogs.length} logs</Pill>
            </div>
          </div>
          <Button variant="soft" onClick={onClose}>Close</Button>
        </div>

        <div className="border-b border-[var(--line)] bg-white/80 px-4 pt-3 sm:px-5">
          <div className="grid grid-cols-3 gap-1.5">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`min-h-10 border px-2 py-2 text-xs font-black transition sm:text-sm ${
                  activeTab === tab.id
                    ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                    : "border-[var(--line)] bg-white text-[var(--muted)] hover:bg-[var(--bg-soft)]"
                }`}
              >
                <span className="block truncate">{tab.label}</span>
                <span className="mt-0.5 block text-[10px] font-bold opacity-70">{tab.count}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="max-h-[calc(88vh-146px)] overflow-y-auto px-4 py-4 sm:px-5">
          {activeTab === "matchups" && (
            <div className="grid gap-3">
              <div className="rounded-none border border-emerald-100 bg-emerald-50/80 px-3 py-3">
                <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-emerald-700">Record</div>
                <div className="mt-1 text-sm font-black text-emerald-950">{recordLine}</div>
              </div>
              <PlayerCountList title="Partners" tone="blue" rows={allPartners} empty="No partners yet." />
              <PlayerCountList title="Most faced" tone="lime" rows={allOpponents} empty="No opponents yet." />
            </div>
          )}
          {activeTab === "results" && <PlayerResultsList player={player} matches={playerMatches} />}
          {activeTab === "logs" && <PlayerLogsList logs={playerLogs} />}
        </div>
      </div>
    </div>
  );
}

function PlayerCountList({ title, tone, rows, empty }: { title: string; tone: "blue" | "lime"; rows: [string, number][]; empty: string }) {
  const styles = {
    blue: "border-sky-100 bg-sky-50/75 text-sky-950",
    lime: "border-lime-100 bg-lime-50/75 text-lime-950",
  } as const;
  const labelStyles = { blue: "text-sky-700", lime: "text-lime-700" } as const;

  return (
    <div className={`rounded-none border px-3 py-3 ${styles[tone]}`}>
      <div className={`text-[11px] font-bold uppercase tracking-[0.08em] ${labelStyles[tone]}`}>{title}</div>
      {rows.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {rows.map(([name, count]) => (
            <span key={name} className="rounded-none bg-white/80 px-2.5 py-1.5 text-xs font-bold ring-1 ring-white/70">
              {name} ({count}x)
            </span>
          ))}
        </div>
      ) : (
        <div className="mt-2 text-sm font-semibold">{empty}</div>
      )}
    </div>
  );
}

function PlayerResultsList({ player, matches }: { player: Player; matches: Match[] }) {
  if (!matches.length) return <Empty text="No games yet." />;

  return (
    <div className="space-y-3">
      {matches.map((match) => {
        const current = match.players.find((entry) => entry.player.id === player.id)!;
        const teammates = match.players.filter((entry) => entry.team === current.team).map((entry) => entry.player.name).join(" + ");
        const opponents = match.players.filter((entry) => entry.team !== current.team).map((entry) => entry.player.name).join(" + ");
        const resultLabel = match.status === "ACTIVE" ? "Live" : current.result === "WIN" ? "Win" : current.result === "LOSS" ? "Loss" : "Draw";
        const resultTone =
          resultLabel === "Win"
            ? "border-emerald-200 bg-emerald-50/60"
            : resultLabel === "Loss"
              ? "border-red-200 bg-red-50/60"
              : resultLabel === "Live"
                ? "border-sky-200 bg-sky-50/60"
                : "border-slate-200 bg-slate-50/70";
        const ResultIcon = resultLabel === "Win" ? CheckCircle2 : resultLabel === "Loss" ? XCircle : resultLabel === "Draw" ? Equal : Zap;
        const resultTextTone = resultLabel === "Win" ? "text-emerald-700" : resultLabel === "Loss" ? "text-red-700" : resultLabel === "Live" ? "text-sky-700" : "text-slate-700";

        return (
          <div key={match.id} className={`rounded-none border px-3.5 py-3 ${resultTone}`}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <strong className="text-sm font-black text-[var(--text)]">Court {match.courtNumber}</strong>
                <div className="mt-0.5 text-xs font-semibold text-[var(--muted)]">{formatLogTime(match.startedAt)}</div>
              </div>
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
      })}
    </div>
  );
}

type DisplayPlayerLog = {
  id: string;
  type: PlayerLog["type"];
  title: string;
  detail: string;
  createdAt: string;
};

function buildPlayerLogs({ player, matches, logs }: { player: Player; matches: Match[]; logs: PlayerLog[] }) {
  const existingLogs = logs.filter((log) => log.playerId === player.id);
  const events: DisplayPlayerLog[] = existingLogs.map((log) => ({
    id: log.id,
    type: log.type,
    title: getLogTitle(log.type),
    detail: log.message || getLogTitle(log.type),
    createdAt: log.createdAt,
  }));

  if (!existingLogs.some((log) => log.type === "ARRIVED")) {
    events.push({ id: `${player.id}-arrived`, type: "ARRIVED", title: "Arrived", detail: "Joined the player list.", createdAt: player.createdAt });
  }

  const eventKeys = new Set(existingLogs.map((log) => `${log.matchId || "none"}:${log.type}`));
  for (const match of matches) {
    const current = match.players.find((entry) => entry.player.id === player.id);
    if (!current) continue;
    if (!eventKeys.has(`${match.id}:MATCH_STARTED`)) {
      events.push({ id: `${match.id}-started`, type: "MATCH_STARTED", title: "Started match", detail: `Started on Court ${match.courtNumber}.`, createdAt: match.startedAt });
    }
    if (match.status === "FINISHED" && match.endedAt) {
      const type: PlayerLog["type"] = current.result === "WIN" ? "MATCH_WON" : current.result === "LOSS" ? "MATCH_LOST" : "MATCH_DRAW";
      if (!eventKeys.has(`${match.id}:${type}`)) {
        events.push({ id: `${match.id}-${type}`, type, title: getLogTitle(type), detail: `Finished on Court ${match.courtNumber}.`, createdAt: match.endedAt });
      }
    }
  }

  if (player.leftAt && !existingLogs.some((log) => log.type === "LEFT")) {
    events.push({ id: `${player.id}-left`, type: "LEFT", title: "Left", detail: "Left the session.", createdAt: player.leftAt });
  }

  return events.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function getLogTitle(type: PlayerLog["type"]) {
  const titles = {
    ARRIVED: "Arrived",
    RESTED: "Rested",
    MATCH_STARTED: "Started match",
    MATCH_WON: "Won match",
    MATCH_LOST: "Lost match",
    MATCH_DRAW: "Match draw",
    MATCH_CANCELED: "Match canceled",
    LEFT: "Left",
    RETURNED: "Returned",
  } as const;
  return titles[type];
}

function PlayerLogsList({ logs }: { logs: DisplayPlayerLog[] }) {
  if (!logs.length) return <Empty text="No player logs yet." />;

  return (
    <div className="space-y-2.5">
      {logs.map((log) => {
        const Icon = getLogIcon(log.type);
        return (
          <div key={log.id} className="grid grid-cols-[34px_1fr] gap-3 border border-[var(--line)] bg-white/84 px-3 py-3">
            <div className={`flex h-8 w-8 items-center justify-center rounded-none ${getLogIconTone(log.type)}`}>
              <Icon size={15} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-sm font-black text-[var(--text)]">{log.title}</strong>
                <span className="text-xs font-semibold text-[var(--muted)]">{formatLogTime(log.createdAt)}</span>
              </div>
              <div className="mt-0.5 text-sm font-medium leading-5 text-[var(--muted)]">{log.detail}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function getLogIcon(type: PlayerLog["type"]) {
  if (type === "ARRIVED" || type === "RETURNED") return Clock3;
  if (type === "RESTED") return Coffee;
  if (type === "MATCH_STARTED") return Play;
  if (type === "MATCH_WON") return CheckCircle2;
  if (type === "MATCH_LOST" || type === "MATCH_CANCELED") return XCircle;
  if (type === "LEFT") return LogOut;
  return Equal;
}

function getLogIconTone(type: PlayerLog["type"]) {
  if (type === "MATCH_WON") return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100";
  if (type === "MATCH_LOST" || type === "MATCH_CANCELED" || type === "LEFT") return "bg-red-50 text-red-700 ring-1 ring-red-100";
  if (type === "MATCH_STARTED") return "bg-sky-50 text-sky-700 ring-1 ring-sky-100";
  if (type === "RESTED") return "bg-slate-100 text-slate-700 ring-1 ring-slate-200";
  return "bg-lime-50 text-lime-700 ring-1 ring-lime-100";
}

function formatLogTime(value: string) {
  return new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
