import { NextRequest, NextResponse } from "next/server";
import { getAgentFinancials } from "@/lib/economics";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const profile = getAgentFinancials(id);

  if (!profile) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  return NextResponse.json(profile);
}
