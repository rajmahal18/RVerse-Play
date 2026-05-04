import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { orderedPair } from "@/lib/matchmaking";

type Params = { params: Promise<{ id: string; matchId: string }> };

async function bumpRelationship(
  tx: Prisma.TransactionClient,
  sessionId: string,
  a: string,
  b: string,
  type: "partner" | "opponent",
) {
  const pair = orderedPair(a, b);
  await tx.playerRelationship.upsert({
    where: { sessionId_playerAId_playerBId: { sessionId, ...pair } },
    create: {
      sessionId,
      ...pair,
      partnerCount: type === "partner" ? 1 : 0,
      opponentCount: type === "opponent" ? 1 : 0,
      lastPartnerAt: type === "partner" ? new Date() : null,
      lastOpponentAt: type === "opponent" ? new Date() : null,
    },
    update: type === "partner" ? { partnerCount: { increment: 1 }, lastPartnerAt: new Date() } : { opponentCount: { increment: 1 }, lastOpponentAt: new Date() },
  });
}

export async function POST(req: Request, { params }: Params) {
  try {
    const { id, matchId } = await params;
    const body = await req.json();
    const action = body.action === "CANCEL" ? "CANCEL" : "FINISH";
    const result = body.result === "A" || body.result === "B" || body.result === "DRAW" ? body.result : null;

    const match = await prisma.match.findUnique({ where: { id: matchId }, include: { players: true } });
    if (!match || match.sessionId !== id) return NextResponse.json({ error: "Match not found" }, { status: 404 });
    if (match.status === "FINISHED") return NextResponse.json({ error: "Match already finished" }, { status: 400 });

    const teamA = match.players.filter((p) => p.team === "A").map((p) => p.playerId);
    const teamB = match.players.filter((p) => p.team === "B").map((p) => p.playerId);
    const allIds = [...teamA, ...teamB];

    if (action === "CANCEL") {
      await prisma.$transaction(async (tx) => {
        await tx.player.updateMany({
          where: { id: { in: allIds }, status: "PLAYING" },
          data: { status: "WAITING", waitStartedAt: new Date() },
        });
        await tx.match.delete({ where: { id: matchId } });
      });

      return NextResponse.json({ ok: true, canceled: true });
    }

    if (!result) {
      return NextResponse.json({ error: "Choose the result before finishing the match." }, { status: 400 });
    }

    const winningTeam = result === "A" || result === "B" ? result : null;
    const completedAt = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.match.update({ where: { id: matchId }, data: { status: "FINISHED", endedAt: completedAt, winningTeam } });
      for (const mp of match.players) {
        const playerResult = winningTeam ? (mp.team === winningTeam ? "WIN" : "LOSS") : "NONE";
        await tx.matchPlayer.update({ where: { id: mp.id }, data: { result: playerResult } });
      }
      for (const playerId of allIds) {
        await tx.player.update({
          where: { id: playerId },
          data: { status: "WAITING", gamesPlayed: { increment: 1 }, waitStartedAt: completedAt },
        });
      }
      for (const team of [teamA, teamB]) {
        if (team.length === 2) await bumpRelationship(tx, id, team[0], team[1], "partner");
      }
      for (const a of teamA) for (const b of teamB) await bumpRelationship(tx, id, a, b, "opponent");
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("finish route failed", error);
    const message = error instanceof Error ? error.message : "Could not finish match.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
