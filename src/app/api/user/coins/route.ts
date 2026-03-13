import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { amount } = await req.json();

  if (!amount || typeof amount !== "number" || amount <= 0 || amount > 100000) {
    return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
  }

  const authUser = getCurrentUser(req);
  const userId = authUser?.id ?? "default-user";

  const db = getDb();
  db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(amount, userId);

  const user = db.prepare("SELECT balance FROM users WHERE id = ?").get(userId) as {
    balance: number;
  };

  return NextResponse.json({ balance: user.balance });
}
