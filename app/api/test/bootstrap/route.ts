// app/api/test/bootstrap/route.ts
import { NextResponse } from "next/server";
import { createTestUser } from "@/lib/testStore";
import { db } from "@/lib/db";
import { cfg } from "@/lib/config";
import bcrypt from "bcryptjs";

export async function POST() {
  if (!cfg.isDev && cfg.MODE !== "beta" && cfg.MODE !== "test") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  
  const { id, email, token } = await createTestUser();
  
  // Hash the test password
  const passwordHash = await bcrypt.hash("testpass123", 10);
  
  // Create actual User record with password
  await db.user.upsert({
    where: { email },
    create: {
      id,
      email,
      passwordHash,
      name: "Test User",
    },
    update: {
      passwordHash, // Update if already exists
    },
  });
  
  // Persist test session
  await db.testSession.create({
    data: {
      token,
      userId: id,
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  
  const res = NextResponse.json({ 
    userId: id, 
    email,
    password: "testpass123" // Return password for convenience in testing
  });
  
  res.cookies.set("test_session", token, {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    maxAge: 3600,
  });
  
  return res;
}