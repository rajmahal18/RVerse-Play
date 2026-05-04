import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  expireOldSessions,
  getPlayerIdFromToken,
  getSessionAccess,
  getSessionAccessCookieName,
  getSessionPlayerCookieName,
  isSessionExpired,
  requireSessionEditor,
} from "@/lib/sessions";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Params) {
  const { id } = await params;
  await expireOldSessions();
  const cookies = _.headers.get("cookie")?.split(";").map((part) => part.trim()) || [];
  const token = cookies.find((part) => part.startsWith(`${getSessionAccessCookieName(id)}=`))?.split("=").slice(1).join("=");
  const playerToken = cookies.find((part) => part.startsWith(`${getSessionPlayerCookieName(id)}=`))?.split("=").slice(1).join("=");
  const access = await getSessionAccess(id, token ? decodeURIComponent(token) : undefined);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const currentPlayerId = getPlayerIdFromToken(id, playerToken ? decodeURIComponent(playerToken) : undefined);

  const session = await prisma.session.findUnique({
    where: { id },
    include: {
      players: { orderBy: [{ status: "asc" }, { gamesPlayed: "asc" }, { waitStartedAt: "asc" }] },
      matches: { orderBy: { startedAt: "desc" }, include: { players: { include: { player: true } } } },
      relationships: true,
    },
  });
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  const viewerPlayer = currentPlayerId ? session.players.find((player) => player.id === currentPlayerId) : null;
  return NextResponse.json({ ...session, viewerCanManage: access.canManage, viewerPlayer });
}

export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const editor = await requireSessionEditor(id);
  if (!editor.ok) return NextResponse.json({ error: editor.error }, { status: editor.status });
  const body = await req.json();
  const existing = await prisma.session.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  if (body.status === "ENDED" || body.action === "end") {
    const endedAt = existing.endedAt || new Date();
    const session = await prisma.session.update({
      where: { id },
      data: {
        status: "ENDED",
        endedAt,
        matches: { updateMany: { where: { status: "ACTIVE" }, data: { status: "FINISHED", endedAt } } },
        players: { updateMany: { where: { status: "PLAYING" }, data: { status: "WAITING", waitStartedAt: endedAt } } },
      },
    });
    return NextResponse.json(session);
  }

  if (isSessionExpired(existing) || existing.status !== "ACTIVE") {
    return NextResponse.json({ error: "Session has ended." }, { status: 410 });
  }

  const session = await prisma.session.update({
    where: { id },
    data: {
      name: body.name === undefined ? undefined : String(body.name).trim(),
      courtCount: body.courtCount === undefined ? undefined : Math.max(1, Math.min(12, Number(body.courtCount))),
      rotationMode: body.rotationMode,
      skillBalancing: body.skillBalancing === undefined ? undefined : Boolean(body.skillBalancing),
    },
  });
  return NextResponse.json(session);
}

export async function DELETE(_: Request, { params }: Params) {
  const { id } = await params;
  const editor = await requireSessionEditor(id);
  if (!editor.ok) return NextResponse.json({ error: editor.error }, { status: editor.status });
  await expireOldSessions();
  const session = await prisma.session.findUnique({ where: { id } });
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  if (session.status !== "ENDED") {
    return NextResponse.json({ error: "End the session before deleting it." }, { status: 400 });
  }

  await prisma.session.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
