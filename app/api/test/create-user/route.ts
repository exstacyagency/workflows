export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { TextEncoder } from "util";
import { db } from "@/lib/db";
import { createTestSession } from "@/lib/auth/testSession";
import { randomUUID } from "crypto";
export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return new Response("Not Found", { status: 404 });
  }

  const user = await db.user.create({
    data: {
      email: `test-${randomUUID()}@local.dev`,
    },
  });

  const token = await createTestSession(user.id);

  const res = Response.json({
    userId: user.id,
    email: user.email,
  });

  res.headers.append(
    "Set-Cookie",
    `test_session=${token}; Path=/; HttpOnly; SameSite=Lax`
  );

  return res;
}

