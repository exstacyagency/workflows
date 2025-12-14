import { getSessionUser } from "@/lib/getSessionUser";

export async function getSessionUserId(): Promise<string | null> {
  const user = await getSessionUser();
  const userId = (user as any)?.id as string | undefined;
  return userId ?? null;
}

