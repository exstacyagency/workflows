"use client";

import { useSession } from "next-auth/react";

export default function WhoAmI() {
  const { data, status } = useSession();

  if (status === "loading") {
    return <div style={{ fontSize: 12, opacity: 0.6 }}>Checking session…</div>;
  }

  if (!data?.user) {
    return <div style={{ fontSize: 12, opacity: 0.6 }}>Not logged in</div>;
  }

  return (
    <div style={{ fontSize: 12, opacity: 0.6 }}>
      Logged in as: {data.user.email}
    </div>
  );
}
