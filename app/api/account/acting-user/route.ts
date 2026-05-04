import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({ error: "Test user switching is disabled." }, { status: 410 });
}
