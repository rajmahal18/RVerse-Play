import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureSessionIsActive, requireSessionEditor } from "@/lib/sessions";

type Params = { params: Promise<{ id: string; playerId: string }> };
const allowedStatuses = new Set(["WAITING", "PLAYING", "RESTING", "LEFT"] as const);

export async function PATCH(req: Request, { params }: Params) {
  const { id, playerId } = await params;
  const editor = await requireSessionEditor(id);
  if (!editor.ok) return NextResponse.json({ error: editor.error }, { status: editor.status });
  const activeSession = await ensureSessionIsActive(id);
  if (!activeSession.ok) return NextResponse.json({ error: activeSession.error }, { status: activeSession.status });
  const body = await req.json();
  const status = body.status;
  if (status !== undefined && !allowedStatuses.has(status)) {
    return NextResponse.json({ error: "Invalid player status." }, { status: 400 });
  }
  const existingPlayer = await prisma.player.findFirst({ where: { id: playerId, sessionId: id } });
  if (!existingPlayer) return NextResponse.json({ error: "Player not found" }, { status: 404 });

  const returningFromLeft = status === "WAITING" && existingPlayer.status === "LEFT";
  const returningToQueue = returningFromLeft || (status === "WAITING" && existingPlayer.status === "RESTING");

  const changedAt = new Date();
  const player = await prisma.player.update({
    where: { id: playerId },
    data: {
      name: body.name === undefined ? undefined : String(body.name).trim(),
      skillLevel: body.skillLevel,
      claimedByJoin: status === "LEFT" ? false : undefined,
      status,
      waitStartedAt: returningFromLeft ? changedAt : undefined,
      leftAt: status === "LEFT" ? changedAt : status === "WAITING" ? null : undefined,
    },
  });
  if (status && status !== existingPlayer.status) {
    const log =
      status === "RESTING"
        ? { type: "RESTED" as const, message: "Moved to rest." }
        : status === "LEFT"
          ? { type: "LEFT" as const, message: "Left the session." }
          : returningToQueue
            ? { type: "RETURNED" as const, message: "Returned to the queue." }
            : null;

    if (log) {
      await prisma.playerLog.create({
        data: {
          sessionId: id,
          playerId,
          type: log.type,
          message: log.message,
          createdAt: changedAt,
        },
      });
    }
  }
  return NextResponse.json(player);
}
