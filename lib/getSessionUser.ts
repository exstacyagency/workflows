import { getAuthSession } from "@/auth";

export async function getSessionUser() {
  const session = await getAuthSession();
  if (!session) return null;
  const userId = (session as any)?.user?.id as string | undefined;
  if (!userId) return null;
  return session.user;
}
