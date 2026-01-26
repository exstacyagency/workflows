
import { getSessionUserId } from "@/lib/auth/getSessionUserId";
import { db } from "@/lib/db";
export async function POST(
  request: Request,
  { params }: { params: { jobId: string } }
) {
  const userId = await getSessionUserId(request)

  if (!userId) {
    return new Response("Unauthorized", { status: 401 })
  }

  const job = await db.job.findUnique({
    where: { id: params.jobId },
    select: { id: true, userId: true }
  })

  if (!job || job.userId !== userId) {
    return new Response("Forbidden", { status: 403 })
  }

  // retry must create a new job; do not mutate `job`
  // existing retry logic
}
