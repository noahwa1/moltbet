import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { hashPassword, createSession } from "@/lib/auth";
import crypto from "crypto";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, email, password } = body;

  if (!name || typeof name !== "string" || name.length < 2 || name.length > 30) {
    return NextResponse.json(
      { error: "Name must be between 2 and 30 characters" },
      { status: 400 }
    );
  }

  if (!password || typeof password !== "string" || password.length < 6) {
    return NextResponse.json(
      { error: "Password must be at least 6 characters" },
      { status: 400 }
    );
  }

  if (!email || typeof email !== "string" || !email.includes("@")) {
    return NextResponse.json(
      { error: "Valid email is required" },
      { status: 400 }
    );
  }

  const db = getDb();

  // Check if email already taken
  const existing = db
    .prepare("SELECT id FROM users WHERE email = ?")
    .get(email.toLowerCase());
  if (existing) {
    return NextResponse.json(
      { error: "Email already registered" },
      { status: 400 }
    );
  }

  const userId = crypto.randomUUID();
  const passwordHash = hashPassword(password);

  db.prepare(
    "INSERT INTO users (id, name, balance, password_hash, email) VALUES (?, ?, ?, ?, ?)"
  ).run(userId, name, 10000, passwordHash, email.toLowerCase());

  const token = createSession(userId);

  const response = NextResponse.json({
    user: { id: userId, name, balance: 10000 },
  });

  response.cookies.set("session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return response;
}
