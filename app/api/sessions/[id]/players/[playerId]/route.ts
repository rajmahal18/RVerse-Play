import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string; playerId: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const { playerId } = await params;
  const body = await req.json();
  const status = body.status;
  const existingPlayer = await prisma.player.findUnique({ where: { id: playerId } });
  if (!existingPlayer) return NextResponse.json({ error: "Player not found" }, { status: 404 });

  const returningToQueue =
    status === "WAITING" && (existingPlayer.status === "LEFT" || existingPlayer.status === "RESTING");

  const player = await prisma.player.update({
    where: { id: playerId },
    data: {
      name: body.name === undefined ? undefined : String(body.name).trim(),
      skillLevel: body.skillLevel,
      status,
      waitStartedAt: returningToQueue ? new Date() : undefined,
      leftAt: status === "LEFT" ? new Date() : status === "WAITING" ? null : undefined,
    },
  });
  return NextResponse.json(player);
}
