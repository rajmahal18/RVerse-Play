import type { SubscriptionStatus, User, UserPlan, UserRole } from "@prisma/client";

type BillingUser = Pick<User, "role" | "plan" | "subscriptionStatus" | "subscriptionEndsAt">;

export const ORGANIZER_MONTHLY_PRICE = Number(process.env.ORGANIZER_MONTHLY_PRICE || 19900);

export function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function isAdmin(user: Pick<User, "role"> | null | undefined) {
  return user?.role === "ADMIN";
}

export function hasActiveOrganizerAccess(user: BillingUser | null | undefined) {
  return Boolean(
    user &&
      user.plan === "ORGANIZER" &&
      user.subscriptionStatus === "ACTIVE" &&
      user.subscriptionEndsAt &&
      user.subscriptionEndsAt > new Date(),
  );
}

export function canCreateSession(user: BillingUser | null | undefined) {
  return isAdmin(user) || hasActiveOrganizerAccess(user);
}

export function getExpiredAccessPatch(user: BillingUser) {
  if (isAdmin(user)) return null;
  if (!user.subscriptionEndsAt) return null;
  if (user.subscriptionStatus !== "ACTIVE") return null;
  if (user.subscriptionEndsAt > new Date()) return null;

  return {
    plan: "FREE" as UserPlan,
    subscriptionStatus: "EXPIRED" as SubscriptionStatus,
    subscriptionEndsAt: user.subscriptionEndsAt,
  };
}

export function getPlanLabel(user: BillingUser | null | undefined) {
  if (!user) return "Guest";
  if (isAdmin(user)) return "Admin";
  return user.plan === "ORGANIZER" ? "Organizer" : "Free";
}

export function getAccessSummary(user: BillingUser | null | undefined) {
  if (!user) return "No active account";
  if (isAdmin(user)) return "Admin access";
  if (hasActiveOrganizerAccess(user)) return "Organizer access active";
  return "Free access";
}

export function normalizeRole(role: UserRole) {
  return role === "ADMIN" ? "Admin" : "User";
}
