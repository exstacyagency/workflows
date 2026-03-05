import { NextRequest } from "next/server";

export function assertInternalSecret(req: NextRequest | Request): Response | null {
  const secret = req.headers?.get("x-internal-secret");
  if (!secret || secret !== process.env.INTERNAL_API_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }
  return null;
}
