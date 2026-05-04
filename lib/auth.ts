import { cookies } from "next/headers";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canCreateSession, getExpiredAccessPatch } from "@/lib/billing";

export const ACTING_USER_COOKIE = "courtflow_user_id";

const TEST_USERS = [
  {
    email: "admin@courtflow.test",
    name: "Admin Tester",
    role: "ADMIN" as const,
    plan: "ORGANIZER" as const,
    subscriptionStatus: "ACTIVE" as const,
  },
  {
    email: "organizer@courtflow.test",
    name: "Organizer Tester",
    role: "USER" as const,
    plan: "ORGANIZER" as const,
    subscriptionStatus: "ACTIVE" as const,
  },
  {
    email: "free@courtflow.test",
    name: "Free Tester",
    role: "USER" as const,
    plan: "FREE" as const,
    subscriptionStatus: "NONE" as const,
  },
] as const;

function defaultExpiry() {
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
}

export async function ensureTestUsers() {
  const activeUntil = defaultExpiry();

  await Promise.all(
    TEST_USERS.map((user) =>
      prisma.user.upsert({
        where: { email: user.email },
        update: { name: user.name },
        create: {
          email: user.email,
          name: user.name,
          role: user.role,
          plan: user.plan,
          subscriptionStatus: user.subscriptionStatus,
          subscriptionEndsAt: user.subscriptionStatus === "ACTIVE" ? activeUntil : null,
        },
      }),
    ),
  );
}

async function refreshUserState(user: User) {
  const patch = getExpiredAccessPatch(user);
  if (!patch) return user;

  return prisma.user.update({
    where: { id: user.id },
    data: patch,
  });
}

export async function getCurrentUser() {
  await ensureTestUsers();

  const cookieStore = await cookies();
  const userId = cookieStore.get(ACTING_USER_COOKIE)?.value;

  let user =
    (userId ? await prisma.user.findUnique({ where: { id: userId } }) : null) ??
    (await prisma.user.findUnique({ where: { email: TEST_USERS[0].email } }));

  if (!user) return null;
  return refreshUserState(user);
}

export async function listTestUsers() {
  await ensureTestUsers();
  const users = await prisma.user.findMany({
    where: { email: { in: TEST_USERS.map((user) => user.email) } },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
  });

  return Promise.all(users.map((user) => refreshUserState(user)));
}

export async function requireSessionCreator() {
  const user = await getCurrentUser();
  if (!user) return { user: null, allowed: false };
  return { user, allowed: canCreateSession(user) };
}
