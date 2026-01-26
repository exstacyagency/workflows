

import { cfg } from "@/lib/config";
import { assertTestEnv } from "@/lib/auth/testSession";
assertTestEnv();

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createTestSession } from "@/lib/auth/testSession";
import { randomUUID } from "crypto";

export async function POST() {
  const isEnabled = cfg.ENABLE_TEST_USERS === true;
  if (!isEnabled) {
    return NextResponse.json({ error: "Disabled" }, { status: 403 });
  }

  const user = await db.user.create({
    data: {
      email: `test-${randomUUID()}@local.dev`,
    },
  });

  const token = await createTestSession(user.id);

  const res = NextResponse.json({
    userId: user.id,
    email: user.email,
  });

  res.headers.append(
    "Set-Cookie",
    `test_session=${token}; Path=/; HttpOnly; SameSite=Lax`
  );

  return res;
}

