"use client";

import { signOut, useSession } from "next-auth/react";

export default function StudioHeader() {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return null;
  }

  if (!session?.user) {
    return (
      <div className="sticky top-0 z-20 flex items-center justify-between border-b border-white/10 bg-transparent px-4 py-3 backdrop-blur-panel">
        <span className="text-sm text-muted">Not signed in</span>
      </div>
    );
  }

  return (
    <div className="sticky top-0 z-20 flex items-center justify-between border-b border-white/10 bg-transparent px-4 py-3 backdrop-blur-panel">
      <div className="text-sm text-muted">
        <strong className="text-white">Signed in as:</strong> {session.user.email}
      </div>

      <button
        onClick={() => signOut({ callbackUrl: "/" })}
        className="inline-flex items-center rounded-pill border border-line bg-transparent px-4 py-2 text-xs font-medium text-muted transition-all hover:bg-bg-elevated hover:text-white"
      >
        Log out
      </button>
    </div>
  );
}
