import { getAuthSession } from "@/auth";
import { getTestUser } from "@/lib/auth/getTestUser";
import { headers } from "next/headers";

export async function getSessionUser() {
  const testUser = getTestUser(headers());
  if (testUser) return testUser;

  const session = await getAuthSession();
  if (!session) return null;
  const userId = (session as any)?.user?.id as string | undefined;
  if (!userId) return null;
  return session.user;
}
