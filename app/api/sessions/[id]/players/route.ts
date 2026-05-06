import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureSessionIsActive, requireSessionEditor } from "@/lib/sessions";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const editor = await requireSessionEditor(id);
  if (!editor.ok) return NextResponse.json({ error: editor.error }, { status: editor.status });
  const activeSession = await ensureSessionIsActive(id);
  if (!activeSession.ok) return NextResponse.json({ error: activeSession.error }, { status: activeSession.status });
  const body = await req.json();
  const names = String(body.names || body.name || "").split("\n").map((n) => n.trim()).filter(Boolean);
  if (!names.length) return NextResponse.json({ error: "Player name is required" }, { status: 400 });
  const arrivedAt = new Date();
  const players = await prisma.$transaction(async (tx) => {
    const createdPlayers = [];
    for (const name of names) {
      const player = await tx.player.create({
        data: { sessionId: id, name, skillLevel: body.skillLevel || "INTERMEDIATE", status: "WAITING", waitStartedAt: arrivedAt },
      });
      createdPlayers.push(player);
    }
    await tx.playerLog.createMany({
      data: createdPlayers.map((player) => ({
        sessionId: id,
        playerId: player.id,
        type: "ARRIVED",
        message: "Added to the player list.",
        createdAt: player.createdAt,
      })),
    });
    return createdPlayers;
  });
  return NextResponse.json(players);
}
