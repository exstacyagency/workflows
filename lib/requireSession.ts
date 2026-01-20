import { getServerSession } from "next-auth";
import type { Session } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function requireSession(): Promise<
  NextResponse | (Session & { user: { id: string } })
> {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as any;

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!user.id && user.email) {
    const found = await prisma.user.findUnique({
      where: { email: user.email },
      select: { id: true },
    });

    if (found) {
      (session as any).user.id = found.id;
      user.id = found.id;
    }
  }

  if (!user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return session as Session & { user: { id: string } };
}
