"use client";

import { useSession } from "next-auth/react";

export default function WhoAmI() {
  useSession();
  return null;
}
