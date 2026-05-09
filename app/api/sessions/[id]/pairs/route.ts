import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { orderedPair } from "@/lib/matchmaking";
import { ensureSessionIsActive, requireSessionEditor } from "@/lib/sessions";

type Params = { params: Promise<{ id: string }> };
type PairInput = { playerAId?: unknown; playerBId?: unknown };

export async function PUT(req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const editor = await requireSessionEditor(id);
    if (!editor.ok) return NextResponse.json({ error: editor.error }, { status: editor.status });
    const activeSession = await ensureSessionIsActive(id);
    if (!activeSession.ok) return NextResponse.json({ error: activeSession.error }, { status: activeSession.status });

    const body = await req.json();
    const pairs: PairInput[] = Array.isArray(body.pairs) ? body.pairs : [];
    const allPlayerIds = pairs.flatMap((pair) => [String(pair?.playerAId || ""), String(pair?.playerBId || "")]).filter(Boolean);

    if (new Set(allPlayerIds).size !== allPlayerIds.length) {
      return NextResponse.json({ error: "A player can only be in one fixed pair." }, { status: 400 });
    }

    const sessionPlayers = await prisma.player.findMany({ where: { sessionId: id }, select: { id: true } });
    const sessionPlayerIds = new Set(sessionPlayers.map((player) => player.id));
    const normalizedPairs: { playerAId: string; playerBId: string }[] = [];

    for (const pair of pairs) {
      const left = String(pair?.playerAId || "");
      const right = String(pair?.playerBId || "");
      if (!left || !right || left === right) continue;
      if (!sessionPlayerIds.has(left) || !sessionPlayerIds.has(right)) {
        return NextResponse.json({ error: "Every fixed pair must use players from this session." }, { status: 400 });
      }
      normalizedPairs.push(orderedPair(left, right));
    }

    await prisma.playerRelationship.updateMany({ where: { sessionId: id, lockedPair: true }, data: { lockedPair: false } });
    for (const pair of normalizedPairs) {
      await prisma.playerRelationship.upsert({
        where: { sessionId_playerAId_playerBId: { sessionId: id, ...pair } },
        create: { sessionId: id, ...pair, lockedPair: true },
        update: { lockedPair: true },
      });
    }
    const relationships = await prisma.playerRelationship.findMany({ where: { sessionId: id } });

    return NextResponse.json({ relationships });
  } catch (error) {
    console.error("save fixed pairs failed", error);
    const message = error instanceof Error ? error.message : "Could not save fixed pairs.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
