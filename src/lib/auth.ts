import { randomBytes, scryptSync } from "crypto";
import { getDb } from "./db";
import { NextRequest } from "next/server";
import { v4 as uuid } from "uuid";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const testHash = scryptSync(password, salt, 64).toString("hex");
  return hash === testHash;
}

export function createSession(userId: string): string {
  const db = getDb();
  const id = uuid();
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(
    "INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)"
  ).run(id, userId, token, expiresAt);
  return token;
}

export function getCurrentUser(
  request?: NextRequest
): { id: string; name: string; balance: number; email: string } | null {
  let token: string | undefined;

  if (request) {
    token = request.cookies.get("session")?.value;
  }

  if (!token) return null;

  return getUserByToken(token);
}

function getUserByToken(
  token: string
): { id: string; name: string; balance: number; email: string } | null {
  const db = getDb();
  const session = db
    .prepare(
      "SELECT user_id, expires_at FROM sessions WHERE token = ?"
    )
    .get(token) as { user_id: string; expires_at: string } | undefined;

  if (!session) return null;

  // Check expiration
  if (new Date(session.expires_at) < new Date()) {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return null;
  }

  const user = db
    .prepare("SELECT id, name, balance, email FROM users WHERE id = ?")
    .get(session.user_id) as
    | { id: string; name: string; balance: number; email: string }
    | undefined;

  return user || null;
}

export function deleteSession(token: string): void {
  const db = getDb();
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}
