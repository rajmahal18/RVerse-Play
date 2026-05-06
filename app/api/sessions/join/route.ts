import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import {
  createSessionAccessToken,
  createSessionPlayerToken,
  getSessionAccessCookieName,
  getSessionPlayerCookieName,
  getPlayerIdFromToken,
  isSessionExpired,
  normalizeJoinCode,
} from "@/lib/sessions";

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

export async function GET(req: Request) {
  const url = new URL(req.url);
  const joinCode = normalizeJoinCode(url.searchParams.get("code") || "");
  if (!joinCode) return NextResponse.json({ error: "Session code is required." }, { status: 400 });

  const session = await prisma.session.findUnique({
    where: { joinCode },
    include: {
      players: {
        where: { status: { not: "LEFT" } },
        orderBy: [{ status: "asc" }, { name: "asc" }],
        select: { id: true, name: true, status: true, claimedByJoin: true, userId: true },
      },
    },
  });
  if (!session) return NextResponse.json({ error: "Session not found." }, { status: 404 });
  if (session.status !== "ACTIVE" || isSessionExpired(session)) {
    if (isSessionExpired(session)) {
      await prisma.session.update({ where: { id: session.id }, data: { status: "ENDED", endedAt: new Date() } });
    }
    return NextResponse.json({ error: "Session has ended." }, { status: 410 });
  }

  const currentPlayerId = getPlayerIdFromToken(
    session.id,
    readCookie(req, getSessionPlayerCookieName(session.id)) ? decodeURIComponent(readCookie(req, getSessionPlayerCookieName(session.id)) || "") : undefined,
  );

  return NextResponse.json({
    id: session.id,
    name: session.name,
    currentPlayerId,
    players: session.players.map((player) => ({
      ...player,
      occupied: (player.status === "PLAYING" || player.claimedByJoin || Boolean(player.userId)) && player.id !== currentPlayerId,
    })),
  });
}

export async function POST(req: Request) {
  const body = await req.json();
  const joinCode = normalizeJoinCode(String(body.code || body.joinCode || ""));
  const name = String(body.name || "").trim();
  const playerId = body.playerId ? String(body.playerId) : "";

  if (!joinCode || (!name && !playerId)) {
    return NextResponse.json({ error: "Session code and player are required." }, { status: 400 });
  }

  const session = await prisma.session.findUnique({ where: { joinCode } });
  if (!session) return NextResponse.json({ error: "Session not found." }, { status: 404 });
  if (session.status !== "ACTIVE" || isSessionExpired(session)) {
    if (isSessionExpired(session)) {
      await prisma.session.update({ where: { id: session.id }, data: { status: "ENDED", endedAt: new Date() } });
    }
    return NextResponse.json({ error: "Session has ended." }, { status: 410 });
  }

  const currentUser = await getCurrentUser();
  let joinedPlayerId = playerId;

  if (playerId) {
    const player = await prisma.player.findFirst({ where: { id: playerId, sessionId: session.id } });
    if (!player) return NextResponse.json({ error: "Player not found in this session." }, { status: 404 });
    const currentPlayerId = getPlayerIdFromToken(
      session.id,
      readCookie(req, getSessionPlayerCookieName(session.id)) ? decodeURIComponent(readCookie(req, getSessionPlayerCookieName(session.id)) || "") : undefined,
    );
    if (player.userId && player.userId !== currentUser?.id) {
      return NextResponse.json({ error: "That player name is reserved by the session host." }, { status: 409 });
    }
    if ((player.status === "PLAYING" || player.claimedByJoin) && currentPlayerId !== player.id) {
      return NextResponse.json({ error: "That player name is already in use." }, { status: 409 });
    }
    if (player.status === "LEFT" || (!player.claimedByJoin && !player.userId)) {
      const joinedAt = new Date();
      await prisma.$transaction(async (tx) => {
        await tx.player.update({
          where: { id: player.id },
          data: {
            claimedByJoin: player.userId ? undefined : true,
            status: player.status === "LEFT" ? "WAITING" : undefined,
            leftAt: player.status === "LEFT" ? null : undefined,
            waitStartedAt: player.status === "LEFT" ? joinedAt : undefined,
          },
        });
        await tx.playerLog.create({
          data: {
            sessionId: session.id,
            playerId: player.id,
            type: player.status === "LEFT" ? "RETURNED" : "ARRIVED",
            message: player.status === "LEFT" ? "Returned to the queue." : "Claimed a player slot.",
            createdAt: joinedAt,
          },
        });
      });
    }
  } else {
    const joinedAt = new Date();
    const player = await prisma.$transaction(async (tx) => {
      const created = await tx.player.create({
        data: {
          sessionId: session.id,
          name,
          claimedByJoin: true,
          status: "WAITING",
          waitStartedAt: joinedAt,
        },
      });
      await tx.playerLog.create({
        data: {
          sessionId: session.id,
          playerId: created.id,
          type: "ARRIVED",
          message: "Joined through the session code.",
          createdAt: created.createdAt,
        },
      });
      return created;
    });
    joinedPlayerId = player.id;
  }

  const response = NextResponse.json({ ok: true, sessionId: session.id, url: `/sessions/${session.id}` });
  response.cookies.set(getSessionAccessCookieName(session.id), createSessionAccessToken(session.id, joinCode), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  response.cookies.set(getSessionPlayerCookieName(session.id), createSessionPlayerToken(session.id, joinedPlayerId), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return response;
}
