import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  const db = getDb();
  const agents = db
    .prepare("SELECT * FROM agents ORDER BY elo DESC")
    .all();
  return NextResponse.json(agents);
}
