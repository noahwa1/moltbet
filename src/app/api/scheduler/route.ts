import { NextResponse } from "next/server";
import { startScheduler } from "@/lib/scheduler";

let started = false;

export async function GET() {
  if (!started) {
    startScheduler();
    started = true;
    return NextResponse.json({ status: "started" });
  }
  return NextResponse.json({ status: "already running" });
}
