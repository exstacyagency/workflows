import type { Metadata } from "next";
import React from "react";
import { Providers } from "./providers";
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
      </body>
    </html>
  );
}
