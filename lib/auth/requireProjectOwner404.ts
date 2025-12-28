import { NextResponse } from "next/server";
import { requireProjectOwner } from "@/lib/requireProjectOwner";

export async function requireProjectOwner404(projectId: string) {
  const auth = await requireProjectOwner(projectId);
  if (auth.error) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return null;
}
