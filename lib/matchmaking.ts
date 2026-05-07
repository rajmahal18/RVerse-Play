import type { Player, PlayerRelationship, Session } from "@prisma/client";

type WaitingPlayer = Pick<Player, "id" | "name" | "skillLevel" | "gamesPlayed" | "waitStartedAt">;
type PairRel = Pick<PlayerRelationship, "playerAId" | "playerBId" | "partnerCount" | "opponentCount" | "lastPartnerAt"> & {
  lockedPair?: boolean;
};

type GeneratedMatch = {
  teamA: WaitingPlayer[];
  teamB: WaitingPlayer[];
  score: number;
  reasons: string[];
};

export type MatchmakingSessionConfig = Pick<Session, "skillBalancing" | "rotationMode">;
export type MatchmakingWaitingPlayer = WaitingPlayer;
export type MatchmakingRelationship = PairRel;

const skillValue = {
  BEGINNER: 1,
  LOW_NOVICE: 2,
  HIGH_NOVICE: 3,
  LOW_INTERMEDIATE: 4,
  HIGH_INTERMEDIATE: 5,
  OPEN: 6,
} as const;
const CANDIDATE_POOL_SIZE = 16;
const PARTNER_REPEAT_PRIORITY = 12000;
const OPPONENT_REPEAT_PRIORITY = 10000;
const REPEAT_COUNT_WEIGHT = 650;

function relKey(a: string, b: string) {
  return [a, b].sort().join(":");
}

function getRel(map: Map<string, PairRel>, a: string, b: string) {
  return map.get(relKey(a, b));
}

function sortWaitingPlayers(players: WaitingPlayer[]) {
  return [...players].sort((a, b) => a.waitStartedAt.getTime() - b.waitStartedAt.getTime() || a.gamesPlayed - b.gamesPlayed);
}

function combos<T>(arr: T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (arr.length < size) return [];
  const [first, ...rest] = arr;
  return [...combos(rest, size - 1).map((c) => [first, ...c]), ...combos(rest, size)];
}

function teamSplits(four: WaitingPlayer[]) {
  const [a, b, c, d] = four;
  return [
    [[a, b], [c, d]],
    [[a, c], [b, d]],
    [[a, d], [b, c]],
  ] as [WaitingPlayer[], WaitingPlayer[]][];
}

function waitingMinutes(p: WaitingPlayer, now: Date) {
  return Math.max(0, Math.floor((now.getTime() - p.waitStartedAt.getTime()) / 60000));
}

function buildLockedPairs(waitingPlayers: WaitingPlayer[], relationships: PairRel[]) {
  const sortedWaiting = sortWaitingPlayers(waitingPlayers);
  const waitingIds = new Set(sortedWaiting.map((player) => player.id));
  const playerMap = new Map(sortedWaiting.map((player) => [player.id, player]));
  const used = new Set<string>();

  const configuredPairs = relationships.filter(
    (relationship) => relationship.lockedPair && waitingIds.has(relationship.playerAId) && waitingIds.has(relationship.playerBId),
  );

  const lockedPairs: WaitingPlayer[][] = [];

  for (const relationship of configuredPairs) {
    if (used.has(relationship.playerAId) || used.has(relationship.playerBId)) continue;
    const playerA = playerMap.get(relationship.playerAId);
    const playerB = playerMap.get(relationship.playerBId);
    if (!playerA || !playerB) continue;
    lockedPairs.push([playerA, playerB]);
    used.add(playerA.id);
    used.add(playerB.id);
  }

  return lockedPairs;
}

function scoreMatch(params: {
  teamA: WaitingPlayer[];
  teamB: WaitingPlayer[];
  minGames: number;
  relMap: Map<string, PairRel>;
  now: Date;
  skillBalancing: boolean;
}) {
  let score = 0;
  const reasons: string[] = [];
  const all = [...params.teamA, ...params.teamB];
  const gameSpread = Math.max(...all.map((player) => player.gamesPlayed)) - Math.min(...all.map((player) => player.gamesPlayed));
  score += gameSpread * 30;

  for (const player of all) {
    score += (player.gamesPlayed - params.minGames) * 40;
    score -= Math.min(waitingMinutes(player, params.now), 60) * 1.5;
  }

  const partnerPairs: [WaitingPlayer, WaitingPlayer][] = [
    [params.teamA[0], params.teamA[1]],
    [params.teamB[0], params.teamB[1]],
  ];

  for (const [left, right] of partnerPairs) {
    const rel = getRel(params.relMap, left.id, right.id);
    const repeat = rel?.partnerCount ?? 0;
    if (repeat > 0) score += PARTNER_REPEAT_PRIORITY;
    score += repeat * REPEAT_COUNT_WEIGHT;
    if (repeat > 0) reasons.push(`${left.name} and ${right.name} have partnered ${repeat}x`);
  }

  let repeatedOpponentPairs = 0;
  for (const left of params.teamA) {
    for (const right of params.teamB) {
      const repeat = getRel(params.relMap, left.id, right.id)?.opponentCount ?? 0;
      if (repeat > 0) repeatedOpponentPairs += 1;
      if (repeat > 0) score += OPPONENT_REPEAT_PRIORITY;
      score += repeat * REPEAT_COUNT_WEIGHT;
    }
  }
  if (repeatedOpponentPairs > 0) reasons.push(`${repeatedOpponentPairs} repeated opponent pair${repeatedOpponentPairs === 1 ? "" : "s"}`);

  if (params.skillBalancing) {
    const aSkill = params.teamA.reduce((sum, player) => sum + skillValue[player.skillLevel], 0);
    const bSkill = params.teamB.reduce((sum, player) => sum + skillValue[player.skillLevel], 0);
    const skillGap = Math.abs(aSkill - bSkill);
    score += skillGap * 18;
    if (skillGap > 1) reasons.push("Skill gap warning");
  }

  return { score, reasons };
}

export function generateBestMatch(params: {
  session: MatchmakingSessionConfig;
  waitingPlayers: WaitingPlayer[];
  relationships: PairRel[];
  now?: Date;
}): GeneratedMatch | null {
  const now = params.now ?? new Date();
  const waiting = sortWaitingPlayers(params.waitingPlayers);
  if (waiting.length < 4) return null;

  const relMap = new Map(params.relationships.map((r) => [relKey(r.playerAId, r.playerBId), r]));
  const minGames = Math.min(...waiting.map((p) => p.gamesPlayed));
  const candidatePool = waiting.slice(0, Math.min(CANDIDATE_POOL_SIZE, waiting.length));
  const shouldBalanceSkills = params.session.skillBalancing || params.session.rotationMode === "SKILL_BALANCED";

  let best: GeneratedMatch | null = null;

  if (params.session.rotationMode === "LOCKED_PAIRS") {
    const candidatePairs = buildLockedPairs(candidatePool, params.relationships);
    if (candidatePairs.length < 2) return null;

    for (const [teamA, teamB] of combos(candidatePairs, 2)) {
      const { score, reasons } = scoreMatch({
        teamA,
        teamB,
        minGames,
        relMap,
        now,
        skillBalancing: shouldBalanceSkills,
      });

      if (!best || score < best.score) best = { teamA, teamB, score, reasons };
    }

    return best;
  }

  for (const four of combos(candidatePool, 4)) {
    for (const [teamA, teamB] of teamSplits(four)) {
      const { score, reasons } = scoreMatch({
        teamA,
        teamB,
        minGames,
        relMap,
        now,
        skillBalancing: shouldBalanceSkills,
      });

      if (!best || score < best.score) best = { teamA, teamB, score, reasons };
    }
  }

  return best;
}

export function generateMatchQueue(params: {
  session: MatchmakingSessionConfig;
  waitingPlayers: WaitingPlayer[];
  relationships: PairRel[];
  maxMatches: number;
  now?: Date;
}) {
  const queue: GeneratedMatch[] = [];
  const remainingPlayers = [...params.waitingPlayers];
  const now = params.now ?? new Date();

  for (let index = 0; index < params.maxMatches; index++) {
    const nextMatch = generateBestMatch({
      session: params.session,
      waitingPlayers: remainingPlayers,
      relationships: params.relationships,
      now,
    });

    if (!nextMatch) break;

    queue.push(nextMatch);
    const pickedIds = new Set([...nextMatch.teamA, ...nextMatch.teamB].map((player) => player.id));
    const filtered = remainingPlayers.filter((player) => !pickedIds.has(player.id));
    remainingPlayers.length = 0;
    remainingPlayers.push(...filtered);
  }

  return queue;
}

export function evaluateMatchup(params: {
  session: MatchmakingSessionConfig;
  teamA: WaitingPlayer[];
  teamB: WaitingPlayer[];
  waitingPlayers: WaitingPlayer[];
  relationships: PairRel[];
  now?: Date;
}) {
  const now = params.now ?? new Date();
  const relMap = new Map(params.relationships.map((relationship) => [relKey(relationship.playerAId, relationship.playerBId), relationship]));
  const minGames = Math.min(...params.waitingPlayers.map((player) => player.gamesPlayed));
  const shouldBalanceSkills = params.session.skillBalancing || params.session.rotationMode === "SKILL_BALANCED";

  return scoreMatch({
    teamA: params.teamA,
    teamB: params.teamB,
    minGames,
    relMap,
    now,
    skillBalancing: shouldBalanceSkills,
  });
}

export function orderedPair(a: string, b: string) {
  const [playerAId, playerBId] = [a, b].sort();
  return { playerAId, playerBId };
}
