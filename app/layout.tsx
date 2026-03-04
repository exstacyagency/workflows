import type { Metadata } from "next";
import React from "react";
import { Providers } from "./providers";
import { SupportWidget } from "@/components/chat/SupportWidget";
// no runtime guards at build-time boundaries

export const metadata: Metadata = {
  title: "Workflows",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
        <SupportWidget />
      </body>
    </html>
  );
}
