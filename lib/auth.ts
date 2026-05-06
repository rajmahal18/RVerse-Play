import { cookies } from "next/headers";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canCreateSession } from "@/lib/billing";
import { hashPassword, verifyPassword } from "@/lib/password";

export const AUTH_COOKIE = "courtflow_user_id";
export const AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@courtflow.test";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (process.env.NODE_ENV === "production" ? "" : "admin12345");

export async function ensureAdminAccount() {
  if (!ADMIN_PASSWORD) return null;

  const existing = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  if (existing) {
    if (existing.role !== "ADMIN" || !existing.passwordHash) {
      return prisma.user.update({
        where: { id: existing.id },
        data: {
          role: "ADMIN",
          plan: "ORGANIZER",
          subscriptionStatus: "ACTIVE",
          passwordHash: existing.passwordHash || hashPassword(ADMIN_PASSWORD),
        },
      });
    }
    return existing;
  }

  return prisma.user.create({
    data: {
      email: ADMIN_EMAIL,
      name: "Admin",
      role: "ADMIN",
      plan: "ORGANIZER",
      subscriptionStatus: "ACTIVE",
      creditBalance: 0,
      passwordHash: hashPassword(ADMIN_PASSWORD),
    },
  });
}

async function refreshUserState(user: User) {
  return user;
}

export async function getCurrentUser() {
  await ensureAdminAccount();

  const cookieStore = await cookies();
  const userId = cookieStore.get(AUTH_COOKIE)?.value;
  const user = userId ? await prisma.user.findUnique({ where: { id: userId } }) : null;

  if (!user) return null;
  if (!user.passwordHash) return null;
  return refreshUserState(user);
}

export async function authenticateUser(email: string, password: string) {
  await ensureAdminAccount();

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user || !verifyPassword(password, user.passwordHash)) return null;
  return user;
}

export async function requireSessionCreator() {
  const user = await getCurrentUser();
  if (!user) return { user: null, allowed: false };
  return { user, allowed: canCreateSession(user) };
}
