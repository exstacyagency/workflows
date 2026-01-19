import "./globals.css";
import type { Metadata } from "next";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import { cfg } from "@/lib/config";

export const metadata: Metadata = {
  title: "FrameForge AI Studio",
  description: "Cinematic AI ad production pipeline powered by FrameForge AI.",
export const metadata = {
  title: "App",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="bg-slate-950">
      <body className="text-slate-50">
        {cfg.RUNTIME_MODE === "alpha" && (
          <div
            style={{
              background: "red",
              color: "white",
              padding: 6,
              textAlign: "center",
              fontWeight: 700,
            }}
          >
            ALPHA MODE — EXPECT FAILURES
          </div>
        )}
        <div className="flex min-h-screen">
          {/* Fixed sidebar */}
          <Sidebar />

          {/* Main area */}
          <div className="flex-1 flex flex-col bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900">
            <TopBar />
            <main className="flex-1 overflow-y-auto">{children}</main>
          </div>
        </div>
      </body>
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
