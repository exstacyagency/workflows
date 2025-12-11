"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  label: string;
  href: string;
};

const mainNav: NavItem[] = [
  { label: "Studio Home", href: "/studio" },
  { label: "Projects", href: "/studio/projects" },
];

function SidebarLink({ href, label }: NavItem) {
  const pathname = usePathname();
  const active =
    pathname === href || (href !== "/" && pathname.startsWith(href));

  return (
    <Link
      href={href}
      className={[
        "flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors",
        active
          ? "bg-slate-800/80 text-slate-50 border border-sky-500/70"
          : "text-slate-300 hover:bg-slate-800/60 hover:text-white border border-transparent",
      ].join(" ")}
    >
      <span>{label}</span>
      {active && <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />}
    </Link>
  );
}

export default function Sidebar() {
  return (
    <aside className="h-screen w-64 bg-slate-950 border-r border-slate-800 flex flex-col">
      {/* Brand */}
      <div className="px-4 py-4 border-b border-slate-800">
        <div className="text-[10px] uppercase tracking-[0.25em] text-slate-500">
          FrameForge
        </div>
        <div className="text-lg font-semibold text-slate-50 mt-1">
          FrameForge AI Studio
        </div>
      </div>

      {/* Main navigation */}
      <nav className="flex-1 px-3 py-4 space-y-6 overflow-y-auto">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-2">
            Main
          </div>
          <div className="space-y-1">
            {mainNav.map((item) => (
              <SidebarLink key={item.href} {...item} />
            ))}
          </div>
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-2">
            Pipeline
          </div>
          <p className="text-[11px] text-slate-500">
            Open a project to see phase-level navigation here.
          </p>
        </div>
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-slate-800 text-[11px] text-slate-500">
        FrameForge AI · v1.0
      </div>
    </aside>
  );
}
