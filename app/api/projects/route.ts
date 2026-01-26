
import { NextResponse } from "next/server"
import { getSessionUserId } from "@/lib/auth/getSessionUserId"
import { db } from "@/lib/db"
export async function POST(request: Request) {
  const userId = await getSessionUserId(request)

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()

  try {
    const project = await db.project.create({
      data: {
        ...body,
        userId
      }
    })
    return NextResponse.json(project)
  } catch (err: any) {
    if (err.code === 'P2002' && err.meta?.target?.includes('userId') && err.meta?.target?.includes('name')) {
      return NextResponse.json({ error: "Project with this name already exists for this user." }, { status: 409 })
    }
    throw err
  }
}

export async function GET(request: Request) {
  const userId = await getSessionUserId(request)

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const projects = await db.project.findMany({
    where: { userId }
  })

  return NextResponse.json(projects)
}
