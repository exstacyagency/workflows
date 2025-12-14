import { NextResponse } from "next/server";
import { validateEnvOnce } from "@/lib/config/validateEnv";

export async function GET() {
  validateEnvOnce();
  return NextResponse.json({ status: 'ok' });
}
