export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // eslint-disable-next-line no-restricted-properties
  const upstream = await fetch(process.env.SPACEBOT_EVENTS_URL!, {
    headers: { Accept: "text/event-stream", "Cache-Control": "no-cache" },
    // @ts-expect-error - Node fetch supports this
    duplex: "half",
  });

  if (!upstream.ok || !upstream.body) {
    return new Response("Failed to connect to Spacebot", { status: 502 });
  }

  const { readable, writable } = new TransformStream();
  upstream.body.pipeTo(writable).catch(() => {});

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
