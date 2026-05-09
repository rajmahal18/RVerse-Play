import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureSessionIsActive, requireSessionEditor } from "@/lib/sessions";

type Params = { params: Promise<{ id: string }> };
const allowedSkillLevels = new Set([
  "BEGINNER",
  "LOW_NOVICE",
  "HIGH_NOVICE",
  "LOW_INTERMEDIATE",
  "HIGH_INTERMEDIATE",
  "OPEN",
] as const);

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const editor = await requireSessionEditor(id);
  if (!editor.ok) return NextResponse.json({ error: editor.error }, { status: editor.status });
  const activeSession = await ensureSessionIsActive(id);
  if (!activeSession.ok) return NextResponse.json({ error: activeSession.error }, { status: activeSession.status });
  const body = await req.json();
  const names = String(body.names || body.name || "").split("\n").map((n) => n.trim()).filter(Boolean);
  if (!names.length) return NextResponse.json({ error: "Player name is required" }, { status: 400 });
  const skillLevel = body.skillLevel || "LOW_INTERMEDIATE";
  if (!allowedSkillLevels.has(skillLevel)) {
    return NextResponse.json({ error: "Invalid skill level." }, { status: 400 });
  }
  const arrivedAt = new Date();
  const players = await Promise.all(
    names.map((name) =>
      prisma.player.create({
        data: {
          sessionId: id,
          name,
          skillLevel,
          status: "WAITING",
          waitStartedAt: arrivedAt,
          logs: {
            create: {
              sessionId: id,
              type: "ARRIVED",
              message: "Added to the player list.",
              createdAt: arrivedAt,
            },
          },
        },
      })
    )
  );
  return NextResponse.json(players);
}
