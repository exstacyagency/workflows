"use client";

import { SessionProvider } from "next-auth/react";
import React from "react";
import { Toaster } from "react-hot-toast";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      {children}
      <Toaster
        position="bottom-right"
        gutter={12}
        toastOptions={{
          duration: 4000,
          className: "victora-toast",
          success: {
            className: "victora-toast victora-toast--success",
            iconTheme: {
              primary: "rgb(144, 233, 168)",
              secondary: "rgb(9, 9, 11)",
            },
          },
          error: {
            className: "victora-toast victora-toast--error",
            iconTheme: {
              primary: "rgb(252, 165, 165)",
              secondary: "rgb(9, 9, 11)",
            },
          },
        }}
      />
    </SessionProvider>
  );
}
