"use client";

import { signOut, useSession } from "next-auth/react";

export default function StudioHeader() {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return null;
  }

  if (!session?.user) {
    return (
      <div style={{ padding: "12px", borderBottom: "1px solid #eee" }}>
        <span>Not signed in</span>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "12px 16px",
        borderBottom: "1px solid #eee",
      }}
    >
      <div>
        <strong>Signed in as:</strong> {session.user.email}
      </div>

      <button
        onClick={() => signOut({ callbackUrl: "/" })}
        style={{
          padding: "6px 12px",
          border: "1px solid #ccc",
          borderRadius: "4px",
          cursor: "pointer",
        }}
      >
        Log out
      </button>
    </div>
  );
}
