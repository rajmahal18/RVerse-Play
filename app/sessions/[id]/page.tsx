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
import {
  applyLateArrivalQueueContext,
  evaluateMatchup,
  generateMatchQueue,
  type MatchmakingRelationship,
  type MatchmakingSessionConfig,
  type MatchmakingWaitingPlayer,
} from "@/lib/matchmaking";

type Player = {
  id: string;
  name: string;
  skillLevel: "BEGINNER" | "LOW_NOVICE" | "HIGH_NOVICE" | "LOW_INTERMEDIATE" | "HIGH_INTERMEDIATE" | "OPEN";
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
type MatchResultChoice = "A" | "B";

const statusTone = { WAITING: "amber", PLAYING: "blue", RESTING: "slate", LEFT: "red" } as const;
const skillLabel = {
  BEGINNER: "Beginner",
  LOW_NOVICE: "Low Novice",
  HIGH_NOVICE: "High Novice",
  LOW_INTERMEDIATE: "Low Intermediate",
  HIGH_INTERMEDIATE: "High Intermediate",
  OPEN: "Open",
} as const;
const skillValue = {
  BEGINNER: 1,
  LOW_NOVICE: 2,
  HIGH_NOVICE: 3,
  LOW_INTERMEDIATE: 4,
  HIGH_INTERMEDIATE: 5,
  OPEN: 6,
} as const;
const rotationModeLabel = {
  FAIR_ROTATION: "Fair Rotation",
  SKILL_BALANCED: "Skill Balanced",
  WINNER_STAYS: "Winner Stays",
  LOCKED_PAIRS: "Fixed Pairs",
} as const;

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

async function requestJsonSafe(input: RequestInfo | URL, init?: RequestInit) {
  try {
    const res = await fetch(input, init);
    return { res, data: await readJsonSafe(res), error: null };
  } catch {
    return { res: null, data: null, error: "Connection lost. Please try again." };
  }
}

export default function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const [sessionId, setSessionId] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [tab, setTab] = useState<Tab>("queue");
  const [names, setNames] = useState("");
  const [skillLevel, setSkillLevel] = useState<Player["skillLevel"]>("LOW_INTERMEDIATE");
  const [error, setError] = useState("");
  const [busyAction, setBusyAction] = useState<null | "addPlayers" | "generate" | "startQueued">(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [playersSubTab, setPlayersSubTab] = useState<"list" | "check-in">("list");
  const [pendingPlayerId, setPendingPlayerId] = useState<string | null>(null);
  const [confirmPlayerAction, setConfirmPlayerAction] = useState<{ player: Player; status: Player["status"] } | null>(null);
  const [resultMatch, setResultMatch] = useState<Match | null>(null);
  const [historyMatch, setHistoryMatch] = useState<Match | null>(null);
  const [pendingMatchId, setPendingMatchId] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [endingSession, setEndingSession] = useState(false);
  const [showGenerateChoice, setShowGenerateChoice] = useState(false);
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
  const isQueueEditing = queueDrafts.some((draft) => draft.editing);

  useEffect(() => {
    void params.then((p) => setSessionId(p.id));
  }, [params]);

  async function load(id = sessionId) {
    if (!id) return;
    const { res, data, error: requestError } = await requestJsonSafe(`/api/sessions/${id}`, { cache: "no-store" });
    if (!res) {
      if (!session) setError(requestError || "Could not open session.");
      return;
    }
    if (!res.ok) {
      setError(data?.error || "Could not open session.");
      return;
    }
    setSession(data as unknown as Session);
  }

  useEffect(() => {
    void load();
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    const interval = window.setInterval(() => {
      if (isQueueEditing) return;
      void load(sessionId);
    }, 5000);
    return () => window.clearInterval(interval);
  }, [isQueueEditing, sessionId]);

  const activeMatches = useMemo(
    () => session?.matches.filter((match) => match.status === "ACTIVE").sort((a, b) => a.courtNumber - b.courtNumber) ?? [],
    [session],
  );
  const finishedMatches = useMemo(
    () => session?.matches.filter((match) => match.status === "FINISHED").sort((a, b) => new Date(b.endedAt ?? b.startedAt).getTime() - new Date(a.endedAt ?? a.startedAt).getTime()) ?? [],
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
  useEffect(() => {
    if (session?.rotationMode !== "LOCKED_PAIRS" && tab === "pairing") {
      setTab("queue");
    }
  }, [session?.rotationMode, tab]);
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
      waitingPlayers: applyLateArrivalQueueContext({
        waitingPlayers: waiting.map((player) => ({
          ...player,
          waitStartedAt: new Date(player.waitStartedAt),
          createdAt: new Date(player.createdAt),
        })),
        players: activePlayers.map((player) => ({
          id: player.id,
          status: player.status,
          gamesPlayed: player.gamesPlayed,
          createdAt: new Date(player.createdAt),
        })),
        matches: session.matches.map((match) => ({ startedAt: new Date(match.startedAt) })),
      }),
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
  }, [activePlayers, session, waiting]);
  useEffect(() => {
    if (isQueueEditing) return;
    setQueueDrafts(toQueueDrafts(queuedMatchups));
  }, [isQueueEditing, queuedMatchups]);

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
    () =>
      session
        ? applyLateArrivalQueueContext({
            waitingPlayers: waiting.map((player) => ({
              ...player,
              waitStartedAt: new Date(player.waitStartedAt),
              createdAt: new Date(player.createdAt),
            })),
            players: activePlayers.map((player) => ({
              id: player.id,
              status: player.status,
              gamesPlayed: player.gamesPlayed,
              createdAt: new Date(player.createdAt),
            })),
            matches: session.matches.map((match) => ({ startedAt: new Date(match.startedAt) })),
          })
        : [],
    [activePlayers, session, waiting],
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
  const openCourtCount = Math.max(0, (session?.courtCount ?? 0) - activeMatches.length);
  const openCourtQueueCount = Math.min(openCourtCount, Math.floor(waiting.length / 4));

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
    setError("");
    setBusyAction("addPlayers");
    const { res, data, error: requestError } = await requestJsonSafe(`/api/sessions/${sessionId}/players`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ names, skillLevel }),
    });
    if (!res || !res.ok) {
      setError(requestError || data?.error || "Could not add players.");
      setBusyAction(null);
      return;
    }
    setNames("");
    setBusyAction(null);
    setPlayersSubTab("list");
    void load();
  }

  async function updatePlayer(playerId: string, status: Player["status"]) {
    if (!session?.viewerCanManage) return;
    setPendingPlayerId(playerId);
    const { res, data, error: requestError } = await requestJsonSafe(`/api/sessions/${sessionId}/players/${playerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res || !res.ok) setError(requestError || data?.error || "Could not update player.");
    setPendingPlayerId(null);
    void load();
  }

  async function confirmUpdatePlayer() {
    if (!confirmPlayerAction) return;
    const action = confirmPlayerAction;
    setConfirmPlayerAction(null);
    await updatePlayer(action.player.id, action.status);
  }

  async function generate(mode: "NEXT" | "OPEN" = "NEXT") {
    if (!session?.viewerCanManage) return;
    setShowGenerateChoice(false);
    setBusyAction("generate");
    setError("");
    const { res, data, error: requestError } = await requestJsonSafe(`/api/sessions/${sessionId}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    });
    if (!res || !res.ok) setError(requestError || data?.error || "Could not generate match");
    setBusyAction(null);
    void load();
    if (res?.ok) setTab("courts");
  }

  async function startQueuedMatch(index: number) {
    if (!session?.viewerCanManage) return;
    const draft = queueDrafts[index];
    if (!draft) return;
    setBusyAction("startQueued");
    setQueuedStartingIndex(index);
    setError("");
    const { res, data, error: requestError } = await requestJsonSafe(`/api/sessions/${sessionId}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamAIds: draft.teamAIds, teamBIds: draft.teamBIds }),
    });
    if (!res || !res.ok) setError(requestError || data?.error || "Could not start queued match");
    setBusyAction(null);
    setQueuedStartingIndex(null);
    if (res?.ok) {
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
    const { res, data, error: requestError } = await requestJsonSafe(`/api/sessions/${sessionId}/pairs`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pairs }),
    });
    if (!res || !res.ok) setError(requestError || data?.error || "Could not save fixed pairs.");
    else setPairDraftsDirty(false);
    setSavingPairs(false);
    void load();
  }

  async function finish(matchId: string, result: "A" | "B") {
    if (!session?.viewerCanManage) return;
    setPendingMatchId(matchId);
    setResultMatch(null);
    const { res, data, error: requestError } = await requestJsonSafe(`/api/sessions/${sessionId}/matches/${matchId}/finish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "FINISH", result }),
    });
    if (!res || !res.ok) {
      setError(requestError || data?.error || "Could not finish match.");
      setPendingMatchId(null);
      return;
    }
    setError("");
    setPendingMatchId(null);
    void load();
  }

  async function cancelMatch(matchId: string) {
    if (!session?.viewerCanManage) return;
    setPendingMatchId(matchId);
    setResultMatch(null);
    const { res, data, error: requestError } = await requestJsonSafe(`/api/sessions/${sessionId}/matches/${matchId}/finish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "CANCEL" }),
    });
    if (!res || !res.ok) {
      setError(requestError || data?.error || "Could not cancel match.");
      setPendingMatchId(null);
      return;
    }
    setError("");
    setPendingMatchId(null);
    void load();
  }

  async function updateHistoryMatchResult(matchId: string, result: MatchResultChoice) {
    if (!session?.viewerCanManage) return;
    setPendingMatchId(matchId);
    const { res, data, error: requestError } = await requestJsonSafe(`/api/sessions/${sessionId}/matches/${matchId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ result }),
    });
    if (!res || !res.ok) {
      setError(requestError || data?.error || "Could not update match result.");
      setPendingMatchId(null);
      return;
    }
    setError("");
    setPendingMatchId(null);
    setHistoryMatch(null);
    void load();
  }

  async function deleteHistoryMatch(matchId: string) {
    if (!session?.viewerCanManage) return;
    if (!window.confirm("Delete this finished match from history?")) return;
    setPendingMatchId(matchId);
    const { res, data, error: requestError } = await requestJsonSafe(`/api/sessions/${sessionId}/matches/${matchId}`, {
      method: "DELETE",
    });
    if (!res || !res.ok) {
      setError(requestError || data?.error || "Could not delete match.");
      setPendingMatchId(null);
      return;
    }
    setError("");
    setPendingMatchId(null);
    setHistoryMatch(null);
    void load();
  }

  async function saveSettings(formData: FormData) {
    if (!session?.viewerCanManage) return;
    setSavingSettings(true);
    const { res, data, error: requestError } = await requestJsonSafe(`/api/sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: formData.get("name"),
        courtCount: Number(formData.get("courtCount")),
        rotationMode: formData.get("rotationMode"),
        skillBalancing: formData.get("skillBalancing") === "on",
      }),
    });
    if (!res || !res.ok) setError(requestError || data?.error || "Could not save settings.");
    setSavingSettings(false);
    void load();
  }

  async function endSession() {
    if (!session?.viewerCanManage) return;
    if (!window.confirm("End this session?")) return;
    setEndingSession(true);
    const { res, data, error: requestError } = await requestJsonSafe(`/api/sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "end" }),
    });
    if (!res || !res.ok) setError(requestError || data?.error || "Could not end session.");
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
    ...(canManage && session.rotationMode === "LOCKED_PAIRS" ? [{ id: "pairing" as const, label: "Fixed Pairs", icon: <UserPlus size={15} /> }] : []),
    { id: "history", label: "History", icon: <History size={15} /> },
    { id: "summary", label: "Summary", icon: <Equal size={15} /> },
    ...(canManage ? [{ id: "settings" as const, label: "Settings", icon: <Settings size={15} /> }] : []),
  ];

  return (
    <main className="mx-auto max-w-6xl px-2 pb-20 sm:px-6">
      <header className="sticky top-0 z-20 -mx-2 border-b border-white/60 bg-[rgba(246,247,241,0.92)] px-2 py-1.5 backdrop-blur-md sm:-mx-6 sm:px-6 sm:py-2">
        <div className="rounded-none border border-[var(--line)] bg-[linear-gradient(135deg,rgba(255,255,255,0.94)_0%,rgba(239,246,235,0.9)_58%,rgba(243,248,201,0.65)_100%)] px-2 py-2 shadow-[0_12px_24px_rgba(18,41,28,0.07)] sm:px-3">
          <div className="grid grid-cols-[1fr_auto] items-start gap-2">
            <div className="flex min-w-0 items-start gap-2">
              <a href="/" className="grid h-8 w-8 shrink-0 place-items-center rounded-none border border-[var(--line)] bg-white/90 text-[var(--text)] shadow-[0_6px_14px_rgba(18,41,28,0.05)]">
                <ArrowLeft size={15} />
              </a>
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <h1 className="max-w-[150px] truncate text-sm font-black text-[var(--text)] sm:max-w-none sm:text-base">{session.name}</h1>
                  <Pill tone={sessionEnded ? "slate" : "green"}>{sessionEnded ? "Ended" : gameStats.label}</Pill>
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  <Pill tone="blue">{session.courtCount} courts</Pill>
                  <Pill tone="amber">{waiting.length} waiting</Pill>
                  <Pill tone="purple">{rotationModeLabel[session.rotationMode as keyof typeof rotationModeLabel] || "Fair Rotation"}</Pill>
                </div>
              </div>
            </div>
            <div className="flex shrink-0 gap-1.5">
              {canManage && !sessionEnded && (
                <Button className="min-h-8 px-2 py-1.5 sm:px-3" onClick={() => setShowGenerateChoice(true)} disabled={busyAction !== null} loading={busyAction === "generate"}>
                  <Shuffle size={14} />
                  <span className="hidden sm:inline">Generate match</span>
                </Button>
              )}
              {canManage && !sessionEnded && (
                <Button className="min-h-8 px-2 py-1.5 sm:px-3" variant="danger" onClick={endSession} loading={endingSession}>
                  <XCircle size={14} />
                  <span className="hidden sm:inline">End session</span>
                </Button>
              )}
            </div>
          </div>

          <div className="mt-2 grid grid-cols-4 gap-1">
            <TopMetric label="Waiting" value={waiting.length} tone="amber" />
            <TopMetric label="Playing" value={playingCount} tone="blue" />
            <TopMetric label="Resting" value={restingCount} tone="green" />
            <TopMetric label="Spread" value={gameStats.spread} tone="slate" />
          </div>

          <nav className="no-scrollbar mt-2 flex gap-1 overflow-x-auto rounded-none border border-[var(--line)] bg-white/85 p-1">
            {tabs.map((item) => (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={`flex min-h-8 shrink-0 items-center gap-1.5 rounded-none px-2.5 py-1.5 text-xs font-semibold transition sm:text-sm ${
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

      {error && <div className="mt-2 rounded-none border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</div>}

      <div className="mt-3 grid gap-3">

        {sessionEnded && <div className="rounded-none border border-[var(--line)] bg-white/80 px-3 py-2 text-sm font-semibold text-[var(--muted)]">This session has ended.</div>}
        {!canManage && session.viewerPlayer && (
          <div className="rounded-none border border-[var(--line)] bg-white/80 px-3 py-2 text-sm font-semibold text-[var(--text)]">
            You joined this session as {session.viewerPlayer.name}.
          </div>
        )}

        {tab === "queue" && (
          <Section title="Next Matchups" action={<Pill tone="green">{queuedMatchups.length ? `${queuedMatchups.length} queued` : "waiting pool"}</Pill>}>
            <div className="space-y-2.5">
              {session.rotationMode === "LOCKED_PAIRS" && waitingUnpairedCount > 0 && (
                <div className="border border-amber-100 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-800">
                  {waitingUnpairedCount} waiting players still need fixed pairs.
                </div>
              )}
              {queuedMatchups.length ? (
                <div className="space-y-2.5">
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
                  busy={pendingMatchId === match.id}
                  onDecide={() => setResultMatch(match)}
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
          <div className="space-y-3">
            {canManage && <nav className="no-scrollbar flex gap-1 overflow-x-auto rounded-none border border-[var(--line)] bg-white/85 p-1">
              <button
                onClick={() => setPlayersSubTab("list")}
                className={`flex min-h-8 shrink-0 items-center gap-1.5 rounded-none px-2.5 py-1.5 text-xs font-semibold transition sm:text-sm ${
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
                className={`flex min-h-8 shrink-0 items-center gap-1.5 rounded-none px-2.5 py-1.5 text-xs font-semibold transition sm:text-sm ${
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
                        <IconActionButton label="Return to queue" onClick={() => setConfirmPlayerAction({ player, status: "WAITING" })} loading={pendingPlayerId === player.id}>
                          <TimerReset size={14} />
                        </IconActionButton>
                      )}
                      {player.status === "WAITING" && (
                        <IconActionButton label="Move to rest" onClick={() => setConfirmPlayerAction({ player, status: "RESTING" })} loading={pendingPlayerId === player.id}>
                          <Coffee size={14} />
                        </IconActionButton>
                      )}
                      {player.status !== "LEFT" && player.status !== "PLAYING" && (
                        <IconActionButton label="Mark left" tone="danger" onClick={() => setConfirmPlayerAction({ player, status: "LEFT" })} loading={pendingPlayerId === player.id}>
                          <LogOut size={14} />
                        </IconActionButton>
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
                        <Select value={skillLevel} onChange={(e) => setSkillLevel(e.target.value as Player["skillLevel"])}>
                          <option value="BEGINNER">Beginner</option>
                          <option value="LOW_NOVICE">Low Novice</option>
                          <option value="HIGH_NOVICE">High Novice</option>
                          <option value="LOW_INTERMEDIATE">Low Intermediate</option>
                          <option value="HIGH_INTERMEDIATE">High Intermediate</option>
                          <option value="OPEN">Open</option>
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
          <Section title="Match History" action={<Pill tone="purple">{finishedMatches.length} done</Pill>}>
            <div className="space-y-3">
              {finishedMatches.map((match) => (
                <MatchSummary key={match.id} match={match} clickable={canManage} onOpen={() => setHistoryMatch(match)} />
              ))}
              {!finishedMatches.length && <Empty text="Finished matches will settle here once courts wrap up." />}
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
                  <option value="LOCKED_PAIRS">Fixed Pairs</option>
                </Select>
              </Field>
              <label className="flex items-center gap-2 rounded-none border border-[var(--line)] bg-white/70 px-3.5 py-3 text-sm font-semibold text-[var(--text)]">
                <input name="skillBalancing" type="checkbox" defaultChecked={session.skillBalancing} />
                Skill balancing
              </label>
              <Button type="submit" loading={savingSettings}>Save settings</Button>
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
      {confirmPlayerAction && (
        <ConfirmPlayerActionModal
          player={confirmPlayerAction.player}
          status={confirmPlayerAction.status}
          busy={pendingPlayerId === confirmPlayerAction.player.id}
          onCancel={() => setConfirmPlayerAction(null)}
          onConfirm={() => void confirmUpdatePlayer()}
        />
      )}
      {showGenerateChoice && (
        <GenerateChoiceModal
          openCourtCount={openCourtCount}
          availableMatchCount={openCourtQueueCount}
          busy={busyAction === "generate"}
          onCancel={() => setShowGenerateChoice(false)}
          onGenerate={generate}
        />
      )}
      {resultMatch && (
        <MatchResultModal
          match={resultMatch}
          busy={pendingMatchId === resultMatch.id}
          onCancel={() => setResultMatch(null)}
          onFinish={finish}
          onVoid={cancelMatch}
        />
      )}
      {historyMatch && (
        <HistoryMatchModal
          match={historyMatch}
          busy={pendingMatchId === historyMatch.id}
          onClose={() => setHistoryMatch(null)}
          onUpdateResult={updateHistoryMatchResult}
          onDelete={deleteHistoryMatch}
        />
      )}
    </main>
  );
}

function getTeamSkillTotal(players: Pick<Player, "skillLevel">[]) {
  return players.reduce((sum, player) => sum + skillValue[player.skillLevel], 0);
}

function getSkillFairness(teamA: Pick<Player, "skillLevel">[], teamB: Pick<Player, "skillLevel">[]) {
  const teamATotal = getTeamSkillTotal(teamA);
  const teamBTotal = getTeamSkillTotal(teamB);
  const gap = Math.abs(teamATotal - teamBTotal);
  const strongerTeam = teamATotal === teamBTotal ? null : teamATotal > teamBTotal ? "Team A" : "Team B";

  if (gap === 0) {
    return { label: "Very Fair", tone: "green" as const, compactText: "Very Fair" };
  }

  if (gap === 1) {
    return { label: "Fair", tone: "blue" as const, compactText: "Fair" };
  }

  if (gap === 2) {
    return { label: `${strongerTeam} slight edge`, tone: "amber" as const, compactText: `${strongerTeam} edge` };
  }

  return { label: `${strongerTeam} clear edge`, tone: "red" as const, compactText: `${strongerTeam} clear edge` };
}

function getMatchSkillFairness(match: Match) {
  const teamA = match.players.filter((entry) => entry.team === "A").map((entry) => entry.player);
  const teamB = match.players.filter((entry) => entry.team === "B").map((entry) => entry.player);
  return getSkillFairness(teamA, teamB);
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
    <div className={`rounded-none border border-white/70 px-1.5 py-1.5 shadow-[0_8px_16px_rgba(18,41,28,0.04)] sm:px-2 sm:py-2 ${tones[tone]}`}>
      <div className="text-sm font-black leading-none sm:text-base">{value}</div>
      <div className="mt-0.5 text-[9px] font-semibold uppercase leading-tight tracking-[0.04em] sm:text-[10px]">{label}</div>
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
            className="grid w-full grid-cols-[1fr_auto] items-center gap-2 px-2.5 py-2 text-left transition hover:bg-white/70 sm:px-3"
          >
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <strong className="truncate text-sm font-black text-[var(--text)]">{player.name}</strong>
                <Pill tone={statusTone[player.status]}>{player.status.toLowerCase()}</Pill>
                <Pill>{skillLabel[player.skillLevel]}</Pill>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-medium leading-4 text-[var(--muted)]">
                <span>{player.gamesPlayed} games</span>
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <Clock3 size={11} className="shrink-0 text-emerald-700" />
                  <span>Arrived {formatClockTime(player.createdAt)}</span>
                </span>
                <span>{getPlayerStatusTimeLabel(player)}</span>
              </div>
            </div>
            <div className="flex shrink-0 gap-1" onClick={(event) => event.stopPropagation()}>{actions(player)}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function IconActionButton({
  label,
  tone = "soft",
  loading,
  children,
  onClick,
}: {
  label: string;
  tone?: "soft" | "danger";
  loading?: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  const toneClass =
    tone === "danger"
      ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
      : "border-[var(--line)] bg-white/90 text-[var(--muted)] hover:bg-[var(--bg-soft)] hover:text-[var(--text)]";

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={loading}
      className={`inline-grid h-8 w-8 place-items-center rounded-none border text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${toneClass}`}
    >
      {loading ? <span className="h-3.5 w-3.5 animate-spin border-2 border-current border-r-transparent" aria-hidden="true" /> : children}
    </button>
  );
}

function ConfirmPlayerActionModal({
  player,
  status,
  busy,
  onCancel,
  onConfirm,
}: {
  player: Player;
  status: Player["status"];
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const copy = {
    WAITING: { title: "Return player?", body: `${player.name} will go back to the waiting queue.`, action: "Return" },
    RESTING: { title: "Move to rest?", body: `${player.name} will be moved out of the waiting queue.`, action: "Rest" },
    LEFT: { title: "Mark as left?", body: `${player.name} will be removed from active player rotation.`, action: "Mark left" },
    PLAYING: { title: "Update player?", body: `${player.name} will be updated.`, action: "Update" },
  }[status];

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-[rgba(17,24,39,0.2)] p-0 sm:items-center sm:justify-center sm:p-4" onClick={onCancel}>
      <div
        className="w-full border border-[var(--line)] bg-white px-4 py-4 shadow-[0_18px_44px_rgba(18,41,28,0.18)] sm:max-w-sm"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="text-base font-black text-[var(--text)]">{copy.title}</h3>
        <p className="mt-1 text-sm font-medium leading-6 text-[var(--muted)]">{copy.body}</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button type="button" variant="soft" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" variant={status === "LEFT" ? "danger" : "primary"} onClick={onConfirm} loading={busy}>
            {copy.action}
          </Button>
        </div>
      </div>
    </div>
  );
}

function GenerateChoiceModal({
  openCourtCount,
  availableMatchCount,
  busy,
  onCancel,
  onGenerate,
}: {
  openCourtCount: number;
  availableMatchCount: number;
  busy: boolean;
  onCancel: () => void;
  onGenerate: (mode: "NEXT" | "OPEN") => void;
}) {
  const canGenerateNext = availableMatchCount >= 1 && openCourtCount >= 1;
  const canFillOpen = availableMatchCount > 1 && openCourtCount > 1;

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-[rgba(17,24,39,0.2)] p-0 sm:items-center sm:justify-center sm:p-4" onClick={onCancel}>
      <div
        className="w-full border border-[var(--line)] bg-white px-4 py-4 shadow-[0_18px_44px_rgba(18,41,28,0.18)] sm:max-w-sm"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-black text-[var(--text)]">Generate</h3>
            <p className="mt-1 text-sm font-medium text-[var(--muted)]">{openCourtCount} open, {availableMatchCount} ready</p>
          </div>
          <Button type="button" variant="plain" onClick={onCancel} disabled={busy}>
            Close
          </Button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button type="button" variant="soft" onClick={() => onGenerate("NEXT")} disabled={!canGenerateNext || busy} loading={busy}>
            Next match only
          </Button>
          <Button type="button" onClick={() => onGenerate("OPEN")} disabled={!canFillOpen || busy} loading={busy}>
            All open courts
          </Button>
        </div>
      </div>
    </div>
  );
}

function MatchResultModal({
  match,
  busy,
  onCancel,
  onFinish,
  onVoid,
}: {
  match: Match;
  busy: boolean;
  onCancel: () => void;
  onFinish: (matchId: string, result: "A" | "B") => void;
  onVoid: (matchId: string) => void;
}) {
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const teamA = match.players.filter((player) => player.team === "A").map((player) => player.player.name).join(" + ");
  const teamB = match.players.filter((player) => player.team === "B").map((player) => player.player.name).join(" + ");

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-[rgba(17,24,39,0.2)] p-0 sm:items-center sm:justify-center sm:p-4" onClick={onCancel}>
      <div
        className="w-full border border-[var(--line)] bg-white px-4 py-4 shadow-[0_18px_44px_rgba(18,41,28,0.18)] sm:max-w-sm"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-black text-[var(--text)]">Court {match.courtNumber}</h3>
            <p className="mt-1 text-sm font-medium text-[var(--muted)]">Choose winning team</p>
          </div>
          <Button type="button" variant="danger" className="min-h-8 px-3 py-1.5 text-xs sm:text-sm" onClick={onCancel} disabled={busy}>
            Close
          </Button>
        </div>

        <div className="mt-3 grid gap-2 text-sm">
          <div className="rounded-none border border-sky-100 bg-[var(--match-a)] px-3 py-2 font-semibold text-sky-900">
            A: {teamA}
          </div>
          <div className="rounded-none border border-lime-100 bg-[var(--match-b)] px-3 py-2 font-semibold text-lime-900">
            B: {teamB}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button type="button" onClick={() => onFinish(match.id, "A")} loading={busy}>
            A wins
          </Button>
          <Button type="button" onClick={() => onFinish(match.id, "B")} loading={busy}>
            B wins
          </Button>
          <Button
            type="button"
            className="col-span-2"
            variant="danger"
            onClick={() => setConfirmCancelOpen(true)}
            disabled={busy}
          >
            Cancel match
          </Button>
        </div>

        {confirmCancelOpen && (
          <div className="fixed inset-0 z-[60] flex items-end bg-[rgba(17,24,39,0.28)] p-0 sm:items-center sm:justify-center sm:p-4" onClick={() => setConfirmCancelOpen(false)}>
            <div
              className="w-full border border-[var(--line)] bg-white px-4 py-4 shadow-[0_18px_44px_rgba(18,41,28,0.18)] sm:max-w-sm"
              onClick={(event) => event.stopPropagation()}
            >
              <h4 className="text-base font-black text-[var(--text)]">Cancel this match?</h4>
              <p className="mt-1 text-sm font-medium leading-6 text-[var(--muted)]">
                The current court assignment will be removed and these players will return to the front of the waiting queue.
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Button type="button" variant="soft" onClick={() => setConfirmCancelOpen(false)} disabled={busy}>
                  Keep match
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => {
                    setConfirmCancelOpen(false);
                    onVoid(match.id);
                  }}
                  loading={busy}
                >
                  Confirm cancel
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MatchBox({
  match,
  busy,
  onDecide,
  disabled = false,
}: {
  match: Match;
  busy: boolean;
  onDecide: () => void;
  disabled?: boolean;
}) {
  const teamAPlayers = match.players.filter((player) => player.team === "A").map((player) => player.player.name);
  const teamBPlayers = match.players.filter((player) => player.team === "B").map((player) => player.player.name);
  const fairness = getMatchSkillFairness(match);

  return (
    <button
      type="button"
      onClick={onDecide}
      disabled={busy || disabled}
      className="pickleball-court court-shell block w-full overflow-hidden text-left shadow-[0_12px_24px_rgba(18,41,28,0.1)] transition hover:brightness-[1.02] focus:outline-none focus:ring-2 focus:ring-emerald-400 disabled:cursor-not-allowed disabled:opacity-70"
    >
      <div className="relative z-10 flex items-center justify-between gap-2 px-2.5 py-2">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <strong className="text-sm font-black leading-none text-white drop-shadow-sm">Court {match.courtNumber}</strong>
            <span className="text-[10px] font-semibold text-white/78">Click court to decide winner</span>
          </div>
          <div className="mt-0.5 text-[9px] font-black uppercase tracking-[0.1em] text-white/76">Active</div>
        </div>
        <div className="bg-white/18 px-2 py-0.5 text-[10px] font-black text-white ring-1 ring-white/24">{fairness.compactText}</div>
      </div>

      <div className="relative z-10 px-2.5 pb-2">
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
    </button>
  );
}

function CourtPlayerSlot({ name }: { name?: string }) {
  return (
    <div className="flex min-w-0 items-center justify-center p-1.5">
      <div className="w-full max-w-[150px] px-1.5 py-2 text-center text-[11px] font-black tracking-[0.01em] text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)] sm:text-[13px]">
        <div className="truncate">{name || "Open"}</div>
      </div>
    </div>
  );
}

function MatchSummary({
  match,
  clickable = false,
  onOpen,
}: {
  match: Match;
  clickable?: boolean;
  onOpen?: () => void;
}) {
  const teamA = match.players.filter((player) => player.team === "A").map((player) => player.player.name).join(" + ");
  const teamB = match.players.filter((player) => player.team === "B").map((player) => player.player.name).join(" + ");
  const fairness = getMatchSkillFairness(match);
  const content = (
    <>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <strong className="text-sm font-black text-[var(--text)]">Court {match.courtNumber}</strong>
          <div className="mt-0.5 text-xs font-semibold text-[var(--muted)]">{formatLogTime(match.endedAt ?? match.startedAt)}</div>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          <Pill tone={fairness.tone}>{fairness.compactText}</Pill>
          <Pill tone={match.winningTeam ? "green" : "slate"}>{match.winningTeam ? `Team ${match.winningTeam} won` : "No result"}</Pill>
        </div>
      </div>
      <div className="space-y-2 text-sm">
        <div className="rounded-none border border-sky-100 bg-[var(--match-a)] px-3 py-2 font-semibold text-sky-900">
          Team A: {teamA}
        </div>
        <div className="rounded-none border border-lime-100 bg-[var(--match-b)] px-3 py-2 font-semibold text-lime-900">
          Team B: {teamB}
        </div>
      </div>
      {clickable && <div className="mt-2 text-xs font-semibold text-[var(--muted)]">Tap to edit result or delete this entry.</div>}
    </>
  );

  if (clickable) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="block w-full rounded-none border border-[var(--line)] bg-white/80 px-4 py-3 text-left shadow-[0_10px_20px_rgba(18,41,28,0.04)] transition hover:bg-white"
      >
        {content}
      </button>
    );
  }

  return <div className="rounded-none border border-[var(--line)] bg-white/80 px-4 py-3 shadow-[0_10px_20px_rgba(18,41,28,0.04)]">{content}</div>;
}

function HistoryMatchModal({
  match,
  busy,
  onClose,
  onUpdateResult,
  onDelete,
}: {
  match: Match;
  busy: boolean;
  onClose: () => void;
  onUpdateResult: (matchId: string, result: MatchResultChoice) => void;
  onDelete: (matchId: string) => void;
}) {
  const teamA = match.players.filter((player) => player.team === "A").map((player) => player.player.name).join(" + ");
  const teamB = match.players.filter((player) => player.team === "B").map((player) => player.player.name).join(" + ");
  const fairness = getMatchSkillFairness(match);

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-[rgba(17,24,39,0.2)] p-0 sm:items-center sm:justify-center sm:p-4" onClick={onClose}>
      <div
        className="w-full border border-[var(--line)] bg-white px-4 py-4 shadow-[0_18px_44px_rgba(18,41,28,0.18)] sm:max-w-md"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-black text-[var(--text)]">Court {match.courtNumber}</h3>
            <p className="mt-1 text-sm font-medium text-[var(--muted)]">{formatLogTime(match.endedAt ?? match.startedAt)}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
            <Pill tone={fairness.tone}>{fairness.compactText}</Pill>
            <Button type="button" variant="plain" onClick={onClose} disabled={busy}>
              Close
            </Button>
          </div>
        </div>

        <div className="mt-3 space-y-2 text-sm">
          <div className="rounded-none border border-sky-100 bg-[var(--match-a)] px-3 py-2 font-semibold text-sky-900">
            Team A: {teamA}
          </div>
          <div className="rounded-none border border-lime-100 bg-[var(--match-b)] px-3 py-2 font-semibold text-lime-900">
            Team B: {teamB}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button type="button" onClick={() => onUpdateResult(match.id, "A")} loading={busy}>
            Team A won
          </Button>
          <Button type="button" onClick={() => onUpdateResult(match.id, "B")} loading={busy}>
            Team B won
          </Button>
          <Button type="button" variant="danger" onClick={() => onDelete(match.id)} loading={busy}>
            Delete match
          </Button>
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
  const activeTeamA =
    activeDraft.teamAIds.length === 2
      ? activeDraft.teamAIds.map((playerId) => waitingPlayerMap.get(playerId)).filter(Boolean) as Player[]
      : matchup.teamA;
  const activeTeamB =
    activeDraft.teamBIds.length === 2
      ? activeDraft.teamBIds.map((playerId) => waitingPlayerMap.get(playerId)).filter(Boolean) as Player[]
      : matchup.teamB;
  const fairness = getSkillFairness(activeTeamA, activeTeamB);

  return (
    <div className={`overflow-hidden border bg-[linear-gradient(180deg,#ffffff_0%,#f7fbf6_100%)] shadow-[0_12px_24px_rgba(18,41,28,0.05)] ${priority ? "border-emerald-500 shadow-[0_12px_24px_rgba(31,157,114,0.1)]" : "border-[var(--line)]"}`}>
      <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] bg-[linear-gradient(90deg,rgba(223,242,255,0.45)_0%,rgba(238,249,208,0.4)_100%)] px-3 py-2">
        <div className="min-w-0">
          <strong className="block truncate text-sm font-black leading-tight text-[var(--text)]">Match {order}</strong>
          <div className="mt-0.5 truncate text-[11px] font-medium text-[var(--muted)]">{priority ? "Next open court" : "Queued after previous"}</div>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          <Pill tone={fairness.tone}>{fairness.label}</Pill>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 p-2.5 sm:p-3">
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

      <div className="grid grid-cols-2 gap-2 border-t border-[var(--line)] bg-white px-3 py-2">
        <Button className="min-h-8 py-1.5 text-xs sm:text-sm" variant="soft" onClick={onEditToggle} disabled={disabled}>
          {activeDraft.editing ? "Done editing" : "Edit"}
        </Button>
        <Button className="min-h-8 py-1.5 text-xs sm:text-sm" onClick={onGame} disabled={busy || disabled}>
          <Play size={13} />
          Game
        </Button>
      </div>

      {matchup.reasons.length > 0 && (
        <div className="border-t border-[var(--line)] bg-[var(--bg-soft)] px-3 py-2 text-[11px] font-medium text-[var(--muted)]">
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
    <div className={`border px-2 py-2 ${styles[tone].wrap}`}>
      <div className={`mb-1.5 text-[10px] font-black uppercase leading-none tracking-[0.08em] ${styles[tone].label}`}>{label}</div>
      <div className="grid gap-1.5">
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
            <Select key={`${team}-${slot}`} value={playerId} onChange={(event) => onChangePlayer(team, slot, event.target.value)} className={`px-2 py-2 text-xs font-bold sm:text-sm ${styles[tone].text}`}>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name} ({option.gamesPlayed}g)
                </option>
              ))}
            </Select>
          ) : (
            <div key={`${team}-${slot}`} className={`min-h-8 border border-white/70 bg-white/72 px-2 py-1.5 text-xs font-black leading-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] sm:text-sm ${styles[tone].text}`}>
              <span className="block truncate">{currentPlayer ? `${currentPlayer.name} (${currentPlayer.gamesPlayed}g)` : "Open"}</span>
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
      title="Fixed Pairs"
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
            Fixed-pairs mode only uses saved pairs. New unpaired players are suggested here by arrival order and must be saved before they can play.
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
          <Empty text="No fixed pairs configured yet." />
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
  let live = 0;

  for (const match of playerMatches) {
    const current = match.players.find((entry) => entry.player.id === player.id);
    if (!current) continue;
    const teammates = match.players.filter((entry) => entry.team === current.team && entry.player.id !== player.id).map((entry) => entry.player.name);
    const opponents = match.players.filter((entry) => entry.team !== current.team).map((entry) => entry.player.name);

    if (match.status === "ACTIVE") live++;
    else if (current.result === "WIN") wins++;
    else if (current.result === "LOSS") losses++;

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
  const recordLine = `${wins}W • ${losses}L${live ? ` • ${live} live` : ""}`;

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
                          : "No result";
                  const resultTone =
                    resultLabel === "Win"
                      ? "border-emerald-200 bg-emerald-50/60"
                      : resultLabel === "Loss"
                        ? "border-red-200 bg-red-50/60"
                        : resultLabel === "Live"
                          ? "border-sky-200 bg-sky-50/60"
                          : "border-slate-200 bg-slate-50/70";
                  const ResultIcon =
                    resultLabel === "Win" ? CheckCircle2 : resultLabel === "Loss" ? XCircle : resultLabel === "Live" ? Zap : Equal;
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
  let live = 0;

  for (const match of playerMatches) {
    const current = match.players.find((entry) => entry.player.id === player.id);
    if (!current) continue;
    const teammates = match.players.filter((entry) => entry.team === current.team && entry.player.id !== player.id).map((entry) => entry.player.name);
    const opponents = match.players.filter((entry) => entry.team !== current.team).map((entry) => entry.player.name);
    if (match.status === "ACTIVE") live++;
    else if (current.result === "WIN") wins++;
    else if (current.result === "LOSS") losses++;
    for (const teammate of teammates) teammateCounts.set(teammate, (teammateCounts.get(teammate) ?? 0) + 1);
    for (const opponent of opponents) opponentCounts.set(opponent, (opponentCounts.get(opponent) ?? 0) + 1);
  }

  const allPartners = [...teammateCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const allOpponents = [...opponentCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const playerLogs = buildPlayerLogs({ player, matches: playerMatches, logs });
  const recordLine = `${wins}W - ${losses}L${live ? ` - ${live} live` : ""}`;
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
        const fairness = getMatchSkillFairness(match);
        const resultLabel = match.status === "ACTIVE" ? "Live" : current.result === "WIN" ? "Win" : current.result === "LOSS" ? "Loss" : "No result";
        const resultTone =
          resultLabel === "Win"
            ? "border-emerald-200 bg-emerald-50/60"
            : resultLabel === "Loss"
              ? "border-red-200 bg-red-50/60"
              : resultLabel === "Live"
                ? "border-sky-200 bg-sky-50/60"
                : "border-slate-200 bg-slate-50/70";
        const ResultIcon = resultLabel === "Win" ? CheckCircle2 : resultLabel === "Loss" ? XCircle : resultLabel === "Live" ? Zap : Equal;
        const resultTextTone = resultLabel === "Win" ? "text-emerald-700" : resultLabel === "Loss" ? "text-red-700" : resultLabel === "Live" ? "text-sky-700" : "text-slate-700";

        return (
          <div key={match.id} className={`rounded-none border px-3.5 py-3 ${resultTone}`}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <strong className="text-sm font-black text-[var(--text)]">Court {match.courtNumber}</strong>
                <div className="mt-0.5 text-xs font-semibold text-[var(--muted)]">{formatLogTime(match.startedAt)}</div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                <Pill tone={fairness.tone}>{fairness.compactText}</Pill>
                <div className={`inline-flex items-center gap-1.5 rounded-none bg-white/90 px-2.5 py-1 text-xs font-bold ${resultTextTone}`}>
                  <ResultIcon size={14} />
                  {resultLabel}
                </div>
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
      const type: PlayerLog["type"] | null = current.result === "WIN" ? "MATCH_WON" : current.result === "LOSS" ? "MATCH_LOST" : null;
      if (type && !eventKeys.has(`${match.id}:${type}`)) {
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
    MATCH_DRAW: "No result",
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
