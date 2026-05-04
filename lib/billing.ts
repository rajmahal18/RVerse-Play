import type { User, UserRole } from "@prisma/client";

type BillingUser = Pick<User, "role" | "creditBalance">;

export const CREDIT_PRICE = Number(process.env.CREDIT_PRICE || 1000);
export const SESSION_CREATE_CREDIT_COST = Number(process.env.SESSION_CREATE_CREDIT_COST || 5);
export const DEFAULT_TOP_UP_CREDITS = Number(process.env.DEFAULT_TOP_UP_CREDITS || 20);

export function getCreditTopUpAmount(credits: number) {
  return credits * CREDIT_PRICE;
}

export function isAdmin(user: Pick<User, "role"> | null | undefined) {
  return user?.role === "ADMIN";
}

export function hasSessionCredits(user: BillingUser | null | undefined) {
  return Boolean(user && user.creditBalance >= SESSION_CREATE_CREDIT_COST);
}

export function canCreateSession(user: BillingUser | null | undefined) {
  return isAdmin(user) || hasSessionCredits(user);
}

export function getPlanLabel(user: BillingUser | null | undefined) {
  if (!user) return "Guest";
  if (isAdmin(user)) return "Admin";
  return `${user.creditBalance} credits`;
}

export function getAccessSummary(user: BillingUser | null | undefined) {
  if (!user) return "No active account";
  if (isAdmin(user)) return "Unlimited session creation";
  if (hasSessionCredits(user)) return `${SESSION_CREATE_CREDIT_COST} credits per session`;
  return `Top up at least ${SESSION_CREATE_CREDIT_COST} credits to create a session`;
}

export function normalizeRole(role: UserRole) {
  return role === "ADMIN" ? "Admin" : "User";
}
