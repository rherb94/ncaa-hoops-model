// src/app/api/teams/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAllTeams } from "@/data/teams";

export async function GET(_req: NextRequest) {
  return NextResponse.json({ teams: getAllTeams() });
}
