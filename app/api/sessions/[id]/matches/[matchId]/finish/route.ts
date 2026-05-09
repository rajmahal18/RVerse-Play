import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPlayerLogType, getPlayerResult, getWinningTeamFromResult } from "@/lib/match-history";
import { orderedPair } from "@/lib/matchmaking";
import { ensureSessionIsActive, requireSessionEditor } from "@/lib/sessions";

type Params = { params: Promise<{ id: string; matchId: string }> };

async function bumpRelationship(
  sessionId: string,
  a: string,
  b: string,
  type: "partner" | "opponent",
  eventAt: Date,
) {
  const pair = orderedPair(a, b);
  await prisma.playerRelationship.upsert({
    where: { sessionId_playerAId_playerBId: { sessionId, ...pair } },
    create: {
      sessionId,
      ...pair,
      partnerCount: type === "partner" ? 1 : 0,
      opponentCount: type === "opponent" ? 1 : 0,
      lastPartnerAt: type === "partner" ? eventAt : null,
      lastOpponentAt: type === "opponent" ? eventAt : null,
    },
    update: type === "partner" ? { partnerCount: { increment: 1 }, lastPartnerAt: eventAt } : { opponentCount: { increment: 1 }, lastOpponentAt: eventAt },
  });
}

export async function POST(req: Request, { params }: Params) {
  try {
    const { id, matchId } = await params;
    const editor = await requireSessionEditor(id);
    if (!editor.ok) return NextResponse.json({ error: editor.error }, { status: editor.status });
    const activeSession = await ensureSessionIsActive(id);
    if (!activeSession.ok) return NextResponse.json({ error: activeSession.error }, { status: activeSession.status });
    const body = await req.json();
    const action = body.action === "CANCEL" ? "CANCEL" : "FINISH";
    const result = body.result === "A" || body.result === "B" ? body.result : null;

    const match = await prisma.match.findFirst({ where: { id: matchId, sessionId: id }, include: { players: true } });
    if (!match) return NextResponse.json({ error: "Match not found. Refresh the session and try again." }, { status: 404 });
    if (match.status === "FINISHED") return NextResponse.json({ error: "Match already finished" }, { status: 400 });

    const teamA = match.players.filter((p) => p.team === "A").map((p) => p.playerId);
    const teamB = match.players.filter((p) => p.team === "B").map((p) => p.playerId);
    const allIds = [...teamA, ...teamB];

    if (action === "CANCEL") {
      const canceledAt = new Date();
      const firstWaitingPlayer = await prisma.player.findFirst({
        where: { sessionId: id, status: "WAITING" },
        orderBy: [{ waitStartedAt: "asc" }, { gamesPlayed: "asc" }, { createdAt: "asc" }],
        select: { waitStartedAt: true },
      });
      const anchorTime = firstWaitingPlayer?.waitStartedAt ?? canceledAt;

      await Promise.all(
        allIds.map((playerId, index) =>
          prisma.player.update({
            where: { id: playerId },
            data: {
              status: "WAITING",
              waitStartedAt: new Date(anchorTime.getTime() - (allIds.length - index) * 1000),
            },
          })
        )
      );
      await prisma.playerLog.createMany({
        data: allIds.map((playerId) => ({
          sessionId: id,
          playerId,
          matchId,
          type: "MATCH_CANCELED",
          message: `Match on Court ${match.courtNumber} was canceled.`,
          createdAt: canceledAt,
        })),
      });
      await prisma.match.delete({ where: { id: matchId } });

      return NextResponse.json({ ok: true, canceled: true });
    }

    if (!result) {
      return NextResponse.json({ error: "Choose the winning team before finishing the match." }, { status: 400 });
    }

    const winningTeam = getWinningTeamFromResult(result);
    const completedAt = new Date();

    await prisma.match.update({ where: { id: matchId }, data: { status: "FINISHED", endedAt: completedAt, winningTeam } });
    await Promise.all(
      match.players.map((mp) =>
        prisma.matchPlayer.update({
          where: { id: mp.id },
          data: { result: getPlayerResult(mp.team, winningTeam) },
        })
      )
    );
    await Promise.all(
      allIds.map((playerId) =>
        prisma.player.update({
          where: { id: playerId },
          data: { status: "WAITING", gamesPlayed: { increment: 1 }, waitStartedAt: completedAt },
        })
      )
    );
    await prisma.playerLog.deleteMany({
      where: {
        matchId,
        type: { in: ["MATCH_WON", "MATCH_LOST", "MATCH_DRAW", "MATCH_CANCELED"] },
      },
    });
    await prisma.playerLog.createMany({
      data: match.players.map((player) => ({
        sessionId: id,
        playerId: player.playerId,
        matchId,
        type: getPlayerLogType(player.team, winningTeam),
        message: `Finished match on Court ${match.courtNumber}.`,
        createdAt: completedAt,
      })),
    });
    for (const team of [teamA, teamB]) {
      if (team.length === 2) await bumpRelationship(id, team[0], team[1], "partner", completedAt);
    }
    for (const a of teamA) for (const b of teamB) await bumpRelationship(id, a, b, "opponent", completedAt);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("finish route failed", error);
    const message = error instanceof Error ? error.message : "Could not finish match.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
