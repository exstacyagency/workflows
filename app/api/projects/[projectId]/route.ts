import { NextRequest, NextResponse } from "next/server"
import { requireSession } from "@/lib/auth/requireSession"
import { getProjectForUser } from "@/lib/projects/getProjectForUser"

export async function GET(
  req: NextRequest,
  { params }: { params: { projectId: string } }
) {
  const session = await requireSession(req)

  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    )
  }

  const project = await getProjectForUser({
    projectId: params.projectId,
    userId: session.user.id,
    includeJobs: true,
  })

  if (!project) {
    return NextResponse.json(
      { error: "Not Found" },
      { status: 404 }
    )
  }

  return NextResponse.json(project, { status: 200 })
}
