import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Params) {
  const { id } = await params;
  const session = await prisma.session.findUnique({
    where: { id },
    include: {
      players: { orderBy: [{ status: "asc" }, { gamesPlayed: "asc" }, { waitStartedAt: "asc" }] },
      matches: { orderBy: { startedAt: "desc" }, include: { players: { include: { player: true } } } },
      relationships: true,
    },
  });
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  return NextResponse.json(session);
}

export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const body = await req.json();
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
