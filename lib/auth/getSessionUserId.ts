import { headers } from "next/headers";
import { cfg } from "@/lib/config";
import { requireSession } from "@/lib/auth/requireSession";

function getHeaderFromRequestLike(request: Request | undefined, key: string): string {
  if (!request) return "";
  return String(request.headers.get(key) ?? "").trim();
}

function getInternalUserIdFromHeaders(request?: Request): string | null {
  const configuredSecret = String(cfg.raw("INTERNAL_WEBHOOK_SECRET") ?? "").trim();

  const reqSecret = getHeaderFromRequestLike(request, "x-internal-secret");
  const reqUserId = getHeaderFromRequestLike(request, "x-internal-user-id");
  if (reqUserId && (!configuredSecret || reqSecret === configuredSecret)) {
    return reqUserId;
  }

  try {
    const hdrs = headers();
    const secret = String(hdrs.get("x-internal-secret") ?? "").trim();
    const userId = String(hdrs.get("x-internal-user-id") ?? "").trim();
    if (userId && (!configuredSecret || secret === configuredSecret)) {
      return userId;
    }
  } catch {
    // no request headers context
  }

  return null;
}

export async function getSessionUserId(request?: Request): Promise<string | null> {
  const internalUserId = getInternalUserIdFromHeaders(request);
  if (internalUserId) return internalUserId;

  const session = await requireSession(request);
  const userId = (session?.user as { id?: string })?.id;
  return userId ?? null;
}
