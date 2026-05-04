import { NextResponse } from "next/server";
import { AUTH_COOKIE, ensureAdminAccount } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  await ensureAdminAccount();

  const body = await req.json();
  const email = String(body.email || "").toLowerCase().trim();
  const name = String(body.name || "").trim();
  const password = String(body.password || "");

  if (!email.includes("@") || password.length < 8) {
    return NextResponse.json({ error: "Use a valid email and at least 8 password characters." }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing?.passwordHash) {
    return NextResponse.json({ error: "An account already exists for that email." }, { status: 409 });
  }

  const passwordHash = hashPassword(password);
  const user = existing
    ? await prisma.user.update({
        where: { id: existing.id },
        data: {
          name: name || existing.name || email.split("@")[0],
          passwordHash,
        },
      })
    : await prisma.user.create({
        data: {
          email,
          name: name || email.split("@")[0],
          passwordHash,
          role: "USER",
          plan: "FREE",
          subscriptionStatus: "NONE",
          creditBalance: 0,
        },
      });

  const response = NextResponse.json({ ok: true, userId: user.id });
  response.cookies.set(AUTH_COOKIE, user.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
