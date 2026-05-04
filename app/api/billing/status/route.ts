import { NextResponse } from "next/server";
import { getCurrentUser, listTestUsers } from "@/lib/auth";
import { canCreateSession, getAccessSummary, getPlanLabel, hasActiveOrganizerAccess, normalizeRole } from "@/lib/billing";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const [currentUser, users] = await Promise.all([getCurrentUser(), listTestUsers()]);

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
          accessSummary: getAccessSummary(currentUser),
          canCreateSession: canCreateSession(currentUser),
          hasActiveOrganizerAccess: hasActiveOrganizerAccess(currentUser),
        }
      : null,
    users: users.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      roleLabel: normalizeRole(user.role),
      plan: user.plan,
      planLabel: getPlanLabel(user),
      subscriptionStatus: user.subscriptionStatus,
      subscriptionEndsAt: user.subscriptionEndsAt,
      canCreateSession: canCreateSession(user),
    })),
    payments,
    monthlyPrice: Number(process.env.ORGANIZER_MONTHLY_PRICE || 19900),
  });
}
