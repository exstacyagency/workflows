import { cookies } from "next/headers";
import { db } from "@/lib/db";

export async function getSessionUserId(): Promise<string> {
  const cookieStore = cookies();
  const testToken = cookieStore.get("test_session")?.value;

  if (process.env.NODE_ENV !== "production" && testToken) {
    const session = await db.testSession.findUnique({
      where: { token: testToken },
    });
    if (!session) throw new Error("UNAUTHENTICATED");
    return session.userId;
  }

  throw new Error("UNAUTHENTICATED");
}
