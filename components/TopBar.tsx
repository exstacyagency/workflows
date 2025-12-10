"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function TopBar() {
  const pathname = usePathname();
  const parts = pathname.split("/").filter(Boolean); // ['', 'projects', 'id'] → ['projects','id']

  const crumbs = [
    { label: "Studio", href: "/" },
    ...parts.map((part, index) => ({
      label: part,
      href: "/" + parts.slice(0, index + 1).join("/"),
    })),
  ];

  return (
    <header className="h-14 px-5 border-b border-slate-800 bg-slate-950/90 backdrop-blur flex items-center justify-between">
      {/* Breadcrumbs */}
      <div className="flex items-center gap-1 text-xs text-slate-400">
        {crumbs.map((crumb, idx) => {
          const isLast = idx === crumbs.length - 1;
          return (
            <span key={crumb.href} className="flex items-center gap-1">
              {idx === 0 ? (
                <Link
                  href={crumb.href}
                  className="hover:text-slate-100 transition-colors"
                >
                  {crumb.label}
                </Link>
              ) : isLast ? (
                <span className="capitalize text-slate-200">
                  {crumb.label}
                </span>
              ) : (
                <Link
                  href={crumb.href}
                  className="hover:text-slate-100 transition-colors capitalize"
                >
                  {crumb.label}
                </Link>
              )}
              {idx < crumbs.length - 1 && (
                <span className="text-slate-600">/</span>
              )}
            </span>
          );
        })}
      </div>

      {/* Right side tools */}
      <div className="flex items-center gap-3 text-xs text-slate-400">
        <span className="hidden md:inline-block text-slate-500">
          Command Palette
        </span>
        <span className="px-2 py-1 rounded-md border border-slate-700 bg-slate-900 font-mono text-[11px]">
          ⌘K
        </span>
      </div>
    </header>
  );
}
