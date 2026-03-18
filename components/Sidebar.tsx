"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { StatusChip } from "@/components/ui";

type NavItem = {
  label: string;
  href: string;
};

const mainNav: NavItem[] = [
  { label: "Studio Home", href: "/studio" },
  { label: "Projects", href: "/studio/projects" },
];

function SidebarLink({ href, label }: NavItem) {
  const pathname = usePathname() ?? "";
  const active =
    !!pathname && (pathname === href || (href !== "/" && pathname.startsWith(href)));

  return (
    <Link
      href={href}
      className={[
        "flex items-center justify-between px-3 py-2 rounded-md text-sm transition-all duration-200",
        active
          ? "bg-panel text-white border border-accent/30"
          : "text-muted hover:bg-panel-strong hover:text-white border border-transparent",
      ].join(" ")}
    >
      <span className={active ? "text-accent" : ""}>{label}</span>
      {active && <span className="w-1.5 h-1.5 rounded-full bg-accent shadow-[0_0_8px_rgba(232,209,122,0.4)]" />}
    </Link>
  );
}

export default function Sidebar() {
  return (
    <aside className="h-screen w-64 bg-panel backdrop-blur-panel border-r border-line flex flex-col sticky top-0 z-30">
      {/* Brand */}
      <div className="px-4 py-4 border-b border-line">
        <div className="text-label uppercase tracking-[0.25em] text-accent font-bold">
          KAIROS
        </div>
        <div className="text-lg font-semibold text-white mt-1 tracking-tight">
          Kairos AI Studio
        </div>
      </div>

      {/* Main navigation */}
      <nav className="flex-1 px-3 py-4 space-y-6 overflow-y-auto">
        <div>
          <div className="eyebrow !m-0 !mb-2">
            Main
          </div>
          <div className="space-y-1">
            {mainNav.map((item) => (
              <SidebarLink key={item.href} {...item} />
            ))}
          </div>
        </div>

        <div>
          <div className="eyebrow !m-0 !mb-2">
            Pipeline
          </div>
          <p className="text-body-sm text-muted italic">
            Open a project to see phase-level navigation here.
          </p>
        </div>
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-line text-body-sm text-muted font-mono">
        <div className="flex items-center justify-between gap-2">
          <span>KAIROS AI</span>
          <StatusChip variant="subtle" className="!px-2 !py-1 !text-label-xs">v1.0</StatusChip>
        </div>
      </div>
    </aside>
  );
}
