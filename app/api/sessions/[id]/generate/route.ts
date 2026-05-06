import { NextResponse } from "next/server";
import type { Match, Player } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { generateMatchQueue } from "@/lib/matchmaking";
import { ensureSessionIsActive, requireSessionEditor } from "@/lib/sessions";

type Params = { params: Promise<{ id: string }> };

export async function POST(_: Request, { params }: Params) {
  const { id } = await params;
  const editor = await requireSessionEditor(id);
  if (!editor.ok) return NextResponse.json({ error: editor.error }, { status: editor.status });
  const activeSession = await ensureSessionIsActive(id);
  if (!activeSession.ok) return NextResponse.json({ error: activeSession.error }, { status: activeSession.status });
  const session = activeSession.session;

  const activeMatches: Match[] = await prisma.match.findMany({ where: { sessionId: id, status: "ACTIVE" } });
  if (activeMatches.length >= session.courtCount) {
    return NextResponse.json({ error: "No open courts. Finish a match first." }, { status: 400 });
  }

  const body = await _.json().catch(() => null);
  const waitingPlayers: Player[] = await prisma.player.findMany({ where: { sessionId: id, status: "WAITING" } });
  const waitingMap = new Map(waitingPlayers.map((player) => [player.id, player]));

  let generated:
    | {
        teamA: Player[];
        teamB: Player[];
        score: number;
        reasons: string[];
      }
    | undefined;

  const customTeamAIds = Array.isArray(body?.teamAIds) ? body.teamAIds.map(String) : null;
  const customTeamBIds = Array.isArray(body?.teamBIds) ? body.teamBIds.map(String) : null;

  if (customTeamAIds && customTeamBIds) {
    const allIds = [...customTeamAIds, ...customTeamBIds];
    if (customTeamAIds.length !== 2 || customTeamBIds.length !== 2 || new Set(allIds).size !== 4) {
      return NextResponse.json({ error: "Pick exactly 4 unique waiting players." }, { status: 400 });
    }

    const selectedPlayers = allIds.map((playerId) => waitingMap.get(playerId)).filter(Boolean) as Player[];
    if (selectedPlayers.length !== 4) {
      return NextResponse.json({ error: "All selected players must still be waiting." }, { status: 400 });
    }

    generated = {
      teamA: customTeamAIds.map((playerId: string) => waitingMap.get(playerId) as Player),
      teamB: customTeamBIds.map((playerId: string) => waitingMap.get(playerId) as Player),
      score: 0,
      reasons: [],
    };
  } else {
    const relationships = await prisma.playerRelationship.findMany({ where: { sessionId: id } });
    generated = generateMatchQueue({
      session,
      waitingPlayers,
      relationships,
      maxMatches: 1,
      now: new Date(),
    })[0] as typeof generated;
  }

  if (!generated) return NextResponse.json({ error: "Need at least 4 waiting players." }, { status: 400 });

  const usedCourts = new Set<number>(activeMatches.map((match: Match) => match.courtNumber));
  let courtNumber = 1;
  while (usedCourts.has(courtNumber)) courtNumber++;

  const allPlayers = [...generated.teamA, ...generated.teamB];
  const match = await prisma.$transaction(async (tx) => {
    const created = await tx.match.create({
      data: {
        sessionId: id,
        courtNumber,
        players: {
          create: [
            ...generated.teamA.map((p) => ({ playerId: p.id, team: "A" as const })),
            ...generated.teamB.map((p) => ({ playerId: p.id, team: "B" as const })),
          ],
        },
      },
      include: { players: { include: { player: true } } },
    });
    await tx.player.updateMany({ where: { id: { in: allPlayers.map((p) => p.id) } }, data: { status: "PLAYING" } });
    await tx.playerLog.createMany({
      data: allPlayers.map((player) => ({
        sessionId: id,
        playerId: player.id,
        matchId: created.id,
        type: "MATCH_STARTED",
        message: `Started match on Court ${courtNumber}.`,
        createdAt: created.startedAt,
      })),
    });
    return created;
  });

  return NextResponse.json({ match, generated });
}
