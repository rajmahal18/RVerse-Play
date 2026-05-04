import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSessionCreator } from "@/lib/auth";

export async function GET() {
  const sessions = await prisma.session.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { players: true, matches: true } }, owner: { select: { id: true, name: true, email: true } } },
  });
  return NextResponse.json(sessions);
}

export async function POST(req: Request) {
  const { user, allowed } = await requireSessionCreator();
  if (!user || !allowed) {
    return NextResponse.json(
      { error: "Organizer access required.", billingUrl: "/billing/upgrade", accountUrl: "/account/billing" },
      { status: 403 },
    );
  }

  const body = await req.json();
  const name = String(body.name || "Open Play").trim();
  const courtCount = Math.max(1, Math.min(12, Number(body.courtCount || 1)));
  const session = await prisma.session.create({
    data: {
      ownerId: user.id,
      name,
      courtCount,
      rotationMode: body.rotationMode || "FAIR_ROTATION",
      skillBalancing: Boolean(body.skillBalancing ?? true),
    },
  });
  return NextResponse.json(session);
}
