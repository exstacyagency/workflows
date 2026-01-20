import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/requireSession";

export async function GET() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const projects = await prisma.project.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(projects);
}

export async function POST(req: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const body = await req.json();

  const project = await prisma.project.create({
    data: {
      name: body.name,
      userId: session.user.id,
    },
  });

  return NextResponse.json(project);
}
