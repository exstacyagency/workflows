import { getAuthSession } from "@/auth";

export async function getSessionUser() {
  const session = await getAuthSession();
  if (!session?.user?.id) return null;
  return session.user;
}
