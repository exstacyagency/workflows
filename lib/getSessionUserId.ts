import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "./prisma";

export async function getSessionUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);

  const userId = (session?.user as any)?.id as string | undefined;
  if (userId) {
    return userId;
  }

  // Fallback: resolve by email if id missing
  if (session?.user?.email) {
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true },
    });

    return user?.id ?? null;
  }

  return null;
}

