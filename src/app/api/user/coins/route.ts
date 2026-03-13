import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function POST(req: NextRequest) {
  const { amount } = await req.json();

  if (!amount || typeof amount !== "number" || amount <= 0 || amount > 100000) {
    return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
  }

  const db = getDb();
  db.prepare("UPDATE users SET balance = balance + ? WHERE id = 'default-user'").run(
    amount
  );

  const user = db.prepare("SELECT balance FROM users WHERE id = 'default-user'").get() as {
    balance: number;
  };

  return NextResponse.json({ balance: user.balance });
}
