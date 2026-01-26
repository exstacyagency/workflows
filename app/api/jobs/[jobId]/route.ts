
import { requireJobAccess } from "@/lib/auth/requireJobAccess";
import { getSessionUserId } from "@/lib/auth/getSessionUserId";

export async function GET(
  _: Request,
  { params }: { params: { jobId: string } }
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    const job = await requireJobAccess(params.jobId, userId);
    return Response.json(job);
  } catch (err: any) {
    if (err.message === "NOT_FOUND") {
      return new Response("Not found", { status: 404 });
    }
    throw err;
  }
}
