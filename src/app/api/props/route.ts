import { NextResponse } from "next/server";
import { generateDailyProps, getActiveProps, getRecentSettledProps } from "@/lib/props";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Generate daily props if needed, then return all active
    const active = generateDailyProps();
    const settled = getRecentSettledProps();

    return NextResponse.json({ active, settled });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to fetch props" },
      { status: 500 }
    );
  }
}
