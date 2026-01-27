
import { requireSession } from "@/lib/auth/requireSession"

export async function getSessionUserId(request?: Request): Promise<string | null> {
  const session = await requireSession(request);
  const userId = (session?.user as { id?: string })?.id;
  return userId ?? null;
}
