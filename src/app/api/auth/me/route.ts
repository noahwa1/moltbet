import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const user = getCurrentUser(request);
  return NextResponse.json({ user: user || null });
}
