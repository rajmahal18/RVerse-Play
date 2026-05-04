import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, requireSessionCreator } from "@/lib/auth";
import { SESSION_CREATE_CREDIT_COST, isAdmin } from "@/lib/billing";
import { expireOldSessions, generateUniqueJoinCode } from "@/lib/sessions";

export async function GET() {
  await expireOldSessions();
  const user = await getCurrentUser();
  if (!user) return NextResponse.json([]);

  const sessions = await prisma.session.findMany({
    where: user.role === "ADMIN" ? undefined : { ownerId: user.id },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { players: true, matches: true } }, owner: { select: { id: true, name: true, email: true } } },
  });
  return NextResponse.json(sessions);
}

export async function POST(req: Request) {
  const { user, allowed } = await requireSessionCreator();
  if (!user) {
    return NextResponse.json({ error: "Sign in to create a session.", loginUrl: "/login" }, { status: 401 });
  }

  if (!allowed) {
    return NextResponse.json(
      { error: `${SESSION_CREATE_CREDIT_COST} credits required to create a session.`, billingUrl: "/billing/upgrade", accountUrl: "/account/billing" },
      { status: 403 },
    );
  }

  const body = await req.json();
  const name = String(body.name || "Open Play").trim();
  const courtCount = Math.max(1, Math.min(12, Number(body.courtCount || 1)));
  const joinCode = await generateUniqueJoinCode();
  try {
    const session = await prisma.$transaction(async (tx) => {
      if (!isAdmin(user)) {
        const debit = await tx.user.updateMany({
          where: { id: user.id, creditBalance: { gte: SESSION_CREATE_CREDIT_COST } },
          data: { creditBalance: { decrement: SESSION_CREATE_CREDIT_COST } },
        });

        if (debit.count !== 1) {
          throw new Error("INSUFFICIENT_CREDITS");
        }
      }

      return tx.session.create({
        data: {
          ownerId: user.id,
          name,
          joinCode,
          courtCount,
          rotationMode: body.rotationMode || "FAIR_ROTATION",
          skillBalancing: Boolean(body.skillBalancing ?? true),
        },
      });
    });

    return NextResponse.json(session);
  } catch (error) {
    if (error instanceof Error && error.message === "INSUFFICIENT_CREDITS") {
      return NextResponse.json(
        { error: `${SESSION_CREATE_CREDIT_COST} credits required to create a session.`, billingUrl: "/billing/upgrade", accountUrl: "/account/billing" },
        { status: 403 },
      );
    }
    throw error;
  }
}
