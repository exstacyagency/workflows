// app/api/auth/register/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hash } from "bcryptjs";
import { logAudit } from "@/lib/logger";
import {
  consumeRegisterAttemptDb,
  recordRegisterFailureDb,
  recordRegisterSuccessDb,
} from "@/lib/authAbuseGuardDb";
import { normalizeEmail } from "@/lib/normalizeEmail";
import { rateLimit } from "@/lib/rateLimiter";

function isValidEmail(email: string): boolean {
  // Basic pragmatic format check for API-side validation.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(req: NextRequest) {
  let email: string | null = null;
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    (req as any).ip ||
    null;

  try {
    const requestRate = await rateLimit(req, {
      keyPrefix: "auth:register",
      limit: 10,
      windowSec: 60,
    });
    if (!requestRate.allowed) {
      return NextResponse.json(
        { error: requestRate.reason ?? "Rate limit exceeded" },
        { status: 429 }
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON payload" },
        { status: 400 }
      );
    }

    email = normalizeEmail(body.email) ?? "";
    const password =
      typeof body.password === "string" ? body.password : "";
    const name =
      typeof body.name === "string" && body.name.trim().length > 0
        ? body.name.trim()
        : null;

    const gate = await consumeRegisterAttemptDb({ ip, email });
    if (!gate.allowed) {
      const retryAfter = Math.ceil((gate.retryAfterMs ?? 0) / 1000);
      return NextResponse.json(
        { error: "Too many attempts. Try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(retryAfter) },
        }
      );
    }

    if (!email || !isValidEmail(email)) {
      await recordRegisterFailureDb({ ip, email });
      return NextResponse.json(
        { error: "Invalid email format" },
        { status: 400 }
      );
    }

    if (!password || password.length < 8) {
      await recordRegisterFailureDb({ ip, email });
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      );
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      await recordRegisterFailureDb({ ip, email });
      return NextResponse.json(
        { error: "User already exists" },
        { status: 409 }
      );
    }

    const passwordHash = await hash(password, 10);

    const user = await prisma.user.create({
      data: { email, name, passwordHash },
      select: { id: true, email: true, name: true, createdAt: true },
    });
    await recordRegisterSuccessDb({ ip, email });

    await logAudit({
      userId: user.id,
      action: "auth.register",
      ip,
      metadata: { email: user.email },
    });

    return NextResponse.json({ user }, { status: 201 });
  } catch (error: any) {
    console.error("Error in /api/auth/register", error);
    await recordRegisterFailureDb({ ip, email });

    if (error?.code === "P2002") {
      return NextResponse.json(
        { error: "User already exists" },
        { status: 409 }
      );
    }

    await logAudit({
      action: "auth.error",
      metadata: {
        scope: "register",
        email,
        error: String(error?.message ?? error),
      },
    });

    return NextResponse.json(
      {
        error: "Internal server error",
      },
      { status: 500 }
    );
  }
}
