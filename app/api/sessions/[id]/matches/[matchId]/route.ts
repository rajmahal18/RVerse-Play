import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  getPlayerResult,
  getWinningTeamFromResult,
  syncFinishedMatchLogs,
  syncSessionGamesPlayed,
  syncSessionRelationships,
} from "@/lib/match-history";
import { requireSessionEditor } from "@/lib/sessions";

type Params = { params: Promise<{ id: string; matchId: string }> };

export async function PATCH(req: Request, { params }: Params) {
  try {
    const { id, matchId } = await params;
    const editor = await requireSessionEditor(id);
    if (!editor.ok) return NextResponse.json({ error: editor.error }, { status: editor.status });

    const body = await req.json().catch(() => null);
    const result = body?.result === "A" || body?.result === "B" ? body.result : null;
    if (!result) return NextResponse.json({ error: "Choose a valid result." }, { status: 400 });

    const match = await prisma.match.findUnique({
      where: { id: matchId },
      include: { players: { select: { id: true, playerId: true, team: true } } },
    });
    if (!match || match.sessionId !== id) return NextResponse.json({ error: "Match not found" }, { status: 404 });
    if (match.status !== "FINISHED") return NextResponse.json({ error: "Only finished matches can be edited here." }, { status: 400 });

    const winningTeam = getWinningTeamFromResult(result);
    const completedAt = match.endedAt ?? new Date();
    const db = prisma as unknown as Prisma.TransactionClient;

    await prisma.match.update({
      where: { id: matchId },
      data: { winningTeam, endedAt: completedAt },
    });

    for (const player of match.players) {
      await prisma.matchPlayer.update({
        where: { id: player.id },
        data: { result: getPlayerResult(player.team, winningTeam) },
      });
    }

    await syncFinishedMatchLogs(db, {
      sessionId: id,
      matchId,
      courtNumber: match.courtNumber,
      completedAt,
      winningTeam,
      players: match.players.map((player) => ({ playerId: player.playerId, team: player.team })),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("match patch failed", error);
    const message = error instanceof Error ? error.message : "Could not update match.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_: Request, { params }: Params) {
  try {
    const { id, matchId } = await params;
    const editor = await requireSessionEditor(id);
    if (!editor.ok) return NextResponse.json({ error: editor.error }, { status: editor.status });

    const match = await prisma.match.findUnique({
      where: { id: matchId },
      include: { players: { select: { playerId: true } } },
    });
    if (!match || match.sessionId !== id) return NextResponse.json({ error: "Match not found" }, { status: 404 });
    if (match.status !== "FINISHED") return NextResponse.json({ error: "Only finished matches can be deleted from history." }, { status: 400 });
    const db = prisma as unknown as Prisma.TransactionClient;

    await prisma.playerLog.deleteMany({ where: { matchId } });
    await prisma.match.delete({ where: { id: matchId } });
    await syncSessionGamesPlayed(db, id);
    await syncSessionRelationships(db, id);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("match delete failed", error);
    const message = error instanceof Error ? error.message : "Could not delete match.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
