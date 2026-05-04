import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const body = await req.json();
  const names = String(body.names || body.name || "").split("\n").map((n) => n.trim()).filter(Boolean);
  if (!names.length) return NextResponse.json({ error: "Player name is required" }, { status: 400 });
  const players = await prisma.$transaction(
    names.map((name) => prisma.player.create({ data: { sessionId: id, name, skillLevel: body.skillLevel || "INTERMEDIATE", status: "WAITING", waitStartedAt: new Date() } }))
  );
  return NextResponse.json(players);
}
