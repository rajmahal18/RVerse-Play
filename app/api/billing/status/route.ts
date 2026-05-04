import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  CREDIT_PRICE,
  DEFAULT_TOP_UP_CREDITS,
  SESSION_CREATE_CREDIT_COST,
  canCreateSession,
  getAccessSummary,
  getCreditTopUpAmount,
  getPlanLabel,
  normalizeRole,
} from "@/lib/billing";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const currentUser = await getCurrentUser();

  const payments = currentUser
    ? await prisma.payment.findMany({
        where: { userId: currentUser.id },
        orderBy: { createdAt: "desc" },
        take: 6,
      })
    : [];

  return NextResponse.json({
    currentUser: currentUser
      ? {
          id: currentUser.id,
          name: currentUser.name,
          email: currentUser.email,
          role: currentUser.role,
          roleLabel: normalizeRole(currentUser.role),
          plan: currentUser.plan,
          planLabel: getPlanLabel(currentUser),
          subscriptionStatus: currentUser.subscriptionStatus,
          subscriptionEndsAt: currentUser.subscriptionEndsAt,
          creditBalance: currentUser.creditBalance,
          accessSummary: getAccessSummary(currentUser),
          canCreateSession: canCreateSession(currentUser),
          isUnlimited: currentUser.role === "ADMIN",
        }
      : null,
    users: [],
    payments,
    creditPrice: CREDIT_PRICE,
    defaultTopUpCredits: DEFAULT_TOP_UP_CREDITS,
    defaultTopUpAmount: getCreditTopUpAmount(DEFAULT_TOP_UP_CREDITS),
    sessionCreateCreditCost: SESSION_CREATE_CREDIT_COST,
  });
}
