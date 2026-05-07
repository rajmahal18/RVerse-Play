import type { MatchResult, Prisma } from "@prisma/client";
import { orderedPair } from "@/lib/matchmaking";

type MatchWithPlayers = {
  id: string;
  endedAt: Date | null;
  startedAt: Date;
  players: { playerId: string; team: "A" | "B" }[];
};

export function getWinningTeamFromResult(result: "A" | "B") {
  return result;
}

export function getPlayerResult(team: "A" | "B", winningTeam: "A" | "B" | null): MatchResult {
  if (!winningTeam) return "NONE";
  return team === winningTeam ? "WIN" : "LOSS";
}

export function getPlayerLogType(team: "A" | "B", winningTeam: "A" | "B") {
  return team === winningTeam ? "MATCH_WON" : "MATCH_LOST";
}

export async function syncFinishedMatchLogs(
  tx: Prisma.TransactionClient,
  params: {
    sessionId: string;
    matchId: string;
    courtNumber: number;
    completedAt: Date;
    winningTeam: "A" | "B";
    players: { playerId: string; team: "A" | "B" }[];
  },
) {
  await tx.playerLog.deleteMany({
    where: {
      matchId: params.matchId,
      type: { in: ["MATCH_WON", "MATCH_LOST", "MATCH_DRAW", "MATCH_CANCELED"] },
    },
  });

  await tx.playerLog.createMany({
    data: params.players.map((player) => ({
      sessionId: params.sessionId,
      playerId: player.playerId,
      matchId: params.matchId,
      type: getPlayerLogType(player.team, params.winningTeam),
      message: `Finished match on Court ${params.courtNumber}.`,
      createdAt: params.completedAt,
    })),
  });
}

export async function syncSessionRelationships(tx: Prisma.TransactionClient, sessionId: string) {
  await tx.playerRelationship.updateMany({
    where: { sessionId },
    data: {
      partnerCount: 0,
      opponentCount: 0,
      lastPartnerAt: null,
      lastOpponentAt: null,
    },
  });

  const finishedMatches = await tx.match.findMany({
    where: { sessionId, status: "FINISHED" },
    orderBy: [{ endedAt: "asc" }, { startedAt: "asc" }],
    include: { players: { select: { playerId: true, team: true } } },
  });

  const stats = new Map<
    string,
    {
      playerAId: string;
      playerBId: string;
      partnerCount: number;
      opponentCount: number;
      lastPartnerAt: Date | null;
      lastOpponentAt: Date | null;
    }
  >();

  for (const match of finishedMatches as MatchWithPlayers[]) {
    const teamA = match.players.filter((player) => player.team === "A").map((player) => player.playerId);
    const teamB = match.players.filter((player) => player.team === "B").map((player) => player.playerId);
    const eventAt = match.endedAt ?? match.startedAt;

    for (const team of [teamA, teamB]) {
      if (team.length !== 2) continue;
      const pair = orderedPair(team[0], team[1]);
      const key = `${pair.playerAId}:${pair.playerBId}`;
      const current = stats.get(key) ?? { ...pair, partnerCount: 0, opponentCount: 0, lastPartnerAt: null, lastOpponentAt: null };
      current.partnerCount += 1;
      current.lastPartnerAt = eventAt;
      stats.set(key, current);
    }

    for (const left of teamA) {
      for (const right of teamB) {
        const pair = orderedPair(left, right);
        const key = `${pair.playerAId}:${pair.playerBId}`;
        const current = stats.get(key) ?? { ...pair, partnerCount: 0, opponentCount: 0, lastPartnerAt: null, lastOpponentAt: null };
        current.opponentCount += 1;
        current.lastOpponentAt = eventAt;
        stats.set(key, current);
      }
    }
  }

  for (const entry of stats.values()) {
    await tx.playerRelationship.upsert({
      where: {
        sessionId_playerAId_playerBId: {
          sessionId,
          playerAId: entry.playerAId,
          playerBId: entry.playerBId,
        },
      },
      create: {
        sessionId,
        playerAId: entry.playerAId,
        playerBId: entry.playerBId,
        partnerCount: entry.partnerCount,
        opponentCount: entry.opponentCount,
        lastPartnerAt: entry.lastPartnerAt,
        lastOpponentAt: entry.lastOpponentAt,
      },
      update: {
        partnerCount: entry.partnerCount,
        opponentCount: entry.opponentCount,
        lastPartnerAt: entry.lastPartnerAt,
        lastOpponentAt: entry.lastOpponentAt,
      },
    });
  }
}

export async function syncSessionGamesPlayed(tx: Prisma.TransactionClient, sessionId: string) {
  const players = await tx.player.findMany({
    where: { sessionId },
    select: { id: true },
  });

  const finishedMatches = await tx.match.findMany({
    where: { sessionId, status: "FINISHED" },
    include: { players: { select: { playerId: true } } },
  });

  const counts = new Map<string, number>();
  for (const match of finishedMatches) {
    for (const player of match.players) {
      counts.set(player.playerId, (counts.get(player.playerId) ?? 0) + 1);
    }
  }

  for (const player of players) {
    await tx.player.update({
      where: { id: player.id },
      data: { gamesPlayed: counts.get(player.id) ?? 0 },
    });
  }
}
