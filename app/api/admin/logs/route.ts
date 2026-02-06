import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const logDir = path.resolve("/workspaces/workflows/logs/anthropic");

  try {
    const files = await readdir(logDir);
    const { searchParams } = new URL(req.url);
    const filename = searchParams.get("file");

    if (filename) {
      if (filename.includes("..") || filename.includes("/")) {
        return new Response("Invalid filename", { status: 400 });
      }

      const content = await readFile(path.join(logDir, filename), "utf-8");
      return new Response(content, {
        headers: { "Content-Type": "application/json" },
      });
    }

    const sorted = files.sort().reverse();
    return new Response(JSON.stringify({ files: sorted }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ files: [], error: String(error) }), {
      headers: { "Content-Type": "application/json" },
    });
  }
}
