import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/getSessionUserId";
import prisma from "@/lib/prisma";
import { sseSubscribe, sseUnsubscribe } from "@/lib/notifications/ssePublisher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { projectId: string } },
) {
  const projectId = String(params.projectId ?? "").trim();
  if (!projectId) {
    return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
  }

  const userId = await getSessionUserId(req as unknown as Request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { userId: true },
  });

  if (!project || project.userId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      sseSubscribe(projectId, controller);
      controller.enqueue(new TextEncoder().encode(": connected\n\n"));
    },
    cancel() {
      if (controllerRef) {
        sseUnsubscribe(projectId, controllerRef);
      }
    },
  });

  const heartbeat = setInterval(() => {
    if (!controllerRef) return;
    try {
      controllerRef.enqueue(new TextEncoder().encode(": ping\n\n"));
    } catch {
      clearInterval(heartbeat);
    }
  }, 25_000);

  req.signal.addEventListener("abort", () => {
    clearInterval(heartbeat);
    if (controllerRef) {
      sseUnsubscribe(projectId, controllerRef);
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
