import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export const SESSION_EXPIRES_HOURS = 10;
const JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function getSessionAccessCookieName(sessionId: string) {
  return `rv_session_${sessionId}`;
}

export function getSessionPlayerCookieName(sessionId: string) {
  return `rv_session_player_${sessionId}`;
}

export function normalizeJoinCode(code: string) {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function createSessionAccessToken(sessionId: string, joinCode: string) {
  return `${sessionId}:${joinCode}`;
}

export function createSessionPlayerToken(sessionId: string, playerId: string) {
  return `${sessionId}:${playerId}`;
}

export function getPlayerIdFromToken(sessionId: string, token: string | undefined) {
  if (!token) return null;
  const [tokenSessionId, playerId] = token.split(":");
  return tokenSessionId === sessionId && playerId ? playerId : null;
}

export function canReadSessionWithToken(session: { id: string; joinCode: string | null }, token: string | undefined) {
  return Boolean(session.joinCode && token === createSessionAccessToken(session.id, session.joinCode));
}

function randomJoinCode() {
  return Array.from({ length: 6 }, () => JOIN_CODE_ALPHABET[Math.floor(Math.random() * JOIN_CODE_ALPHABET.length)]).join("");
}

export async function generateUniqueJoinCode() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const joinCode = randomJoinCode();
    const existing = await prisma.session.findUnique({ where: { joinCode } });
    if (!existing) return joinCode;
  }
  throw new Error("Could not generate a session code.");
}

export function getSessionExpiryDate(createdAt: Date) {
  return new Date(createdAt.getTime() + SESSION_EXPIRES_HOURS * 60 * 60 * 1000);
}

export function isSessionExpired(session: { status: string; createdAt: Date }) {
  return session.status === "ACTIVE" && getSessionExpiryDate(session.createdAt) <= new Date();
}

export async function expireOldSessions() {
  const cutoff = new Date(Date.now() - SESSION_EXPIRES_HOURS * 60 * 60 * 1000);
  await prisma.session.updateMany({
    where: { status: "ACTIVE", createdAt: { lte: cutoff } },
    data: { status: "ENDED", endedAt: new Date() },
  });
}

export async function ensureSessionIsActive(id: string) {
  const session = await prisma.session.findUnique({ where: { id } });
  if (!session) return { ok: false as const, status: 404, error: "Session not found" };

  if (isSessionExpired(session)) {
    await prisma.session.update({ where: { id }, data: { status: "ENDED", endedAt: new Date() } });
    return { ok: false as const, status: 410, error: "Session has ended." };
  }

  if (session.status !== "ACTIVE") {
    return { ok: false as const, status: 410, error: "Session has ended." };
  }

  return { ok: true as const, session };
}

export async function requireSessionEditor(id: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, status: 401, error: "Sign in required." };

  const session = await prisma.session.findUnique({ where: { id } });
  if (!session) return { ok: false as const, status: 404, error: "Session not found" };
  if (user.role !== "ADMIN" && session.ownerId !== user.id) {
    return { ok: false as const, status: 403, error: "You do not have access to this session." };
  }

  return { ok: true as const, user, session };
}

export async function getSessionAccess(id: string, token: string | undefined) {
  const user = await getCurrentUser();
  const session = await prisma.session.findUnique({ where: { id } });
  if (!session) return { ok: false as const, status: 404, error: "Session not found" };

  const canManage = Boolean(user && (user.role === "ADMIN" || session.ownerId === user.id));
  if (canManage || canReadSessionWithToken(session, token)) {
    return { ok: true as const, session, user, canManage };
  }

  return { ok: false as const, status: 403, error: "Session code required." };
}
