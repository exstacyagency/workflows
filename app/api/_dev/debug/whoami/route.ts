import { cfg } from "@/lib/config";
import { getAuthSession } from "@/auth";

export async function GET() {
  const securitySweep = cfg.securitySweep;
  const isProd = cfg.isProd;

  void isProd; // avoid unused; prod status not part of allow condition

  /**
   * Allow ONLY during security sweep runs.
   * Block everywhere else (including normal prod).
   */
  if (!securitySweep) {
    return new Response("Not Found", { status: 404 });
  }

  const session = await getAuthSession();

  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  return Response.json({
    id: (session.user as any).id as string,
    email: session.user.email,
  });
}
