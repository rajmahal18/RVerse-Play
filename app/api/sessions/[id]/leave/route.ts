import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPlayerIdFromToken, getSessionPlayerCookieName } from "@/lib/sessions";

type Params = { params: Promise<{ id: string }> };

function readCookie(req: Request, name: string) {
  return req.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.split("=")
    .slice(1)
    .join("=");
}

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const playerToken = readCookie(req, getSessionPlayerCookieName(id));
  const playerId = getPlayerIdFromToken(id, playerToken ? decodeURIComponent(playerToken) : undefined);

  if (playerId) {
    await prisma.player.updateMany({
      where: { id: playerId, sessionId: id },
      data: { claimedByJoin: false },
    });
  }

  return NextResponse.json({ ok: true });
}
