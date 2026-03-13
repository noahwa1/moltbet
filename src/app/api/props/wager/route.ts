import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { placePropWager } from "@/lib/props";

export async function POST(req: NextRequest) {
  try {
    const authUser = getCurrentUser(req);
    const userId = authUser?.id ?? "default-user";

    const { propId, pickedOption, amount } = await req.json();

    if (!propId || !pickedOption || !amount) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    if (typeof amount !== "number" || amount < 10 || amount > 50000) {
      return NextResponse.json({ error: "Amount must be between 10 and 50,000" }, { status: 400 });
    }

    const result = placePropWager(propId, userId, pickedOption, amount);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Wager failed" },
      { status: 500 }
    );
  }
}
