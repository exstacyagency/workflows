"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { StatusChip } from "@/components/ui";

export default function TopBar() {
  const pathname = usePathname() ?? "";
  if (!pathname) {
    return null;
  }
  const parts = pathname.split("/").filter(Boolean); // ['', 'projects', 'id'] → ['projects','id']

  const crumbs = [
    { label: "Studio", href: "/" },
    ...parts.map((part, index) => ({
      label: part,
      href: "/" + parts.slice(0, index + 1).join("/"),
    })),
  ];

  return (
    <header className="h-14 px-5 border-b border-line bg-transparent backdrop-blur-panel sticky top-0 z-20 flex items-center justify-between">
      {/* Breadcrumbs */}
      <div className="flex items-center gap-1 text-xs text-muted">
        {crumbs.map((crumb, idx) => {
          const isLast = idx === crumbs.length - 1;
          return (
            <span key={crumb.href} className="flex items-center gap-1">
              {idx === 0 ? (
                <Link
                  href={crumb.href}
                  className="hover:text-white transition-colors"
                >
                  {crumb.label}
                </Link>
              ) : isLast ? (
                <span className="capitalize text-white">
                  {crumb.label}
                </span>
              ) : (
                <Link
                  href={crumb.href}
                  className="hover:text-white transition-colors capitalize"
                >
                  {crumb.label}
                </Link>
              )}
              {idx < crumbs.length - 1 && (
                <span className="opacity-30">/</span>
              )}
            </span>
          );
        })}
      </div>

      {/* Right side tools */}
      <div className="flex items-center gap-3 text-xs text-muted">
        <span className="hidden md:inline-block">
          Command Palette
        </span>
        <StatusChip variant="info" className="!rounded-md !px-2 !py-1 !normal-case !tracking-normal">
          ⌘K
        </StatusChip>
      </div>
    </header>
  );
}
