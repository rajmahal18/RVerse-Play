import { NextResponse } from "next/server";
import { ACTING_USER_COOKIE, ensureTestUsers } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  await ensureTestUsers();
  const body = await req.json();
  const userId = String(body.userId || "");
  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  const response = NextResponse.json({ ok: true, userId: user.id });
  response.cookies.set(ACTING_USER_COOKIE, user.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
