"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

type GlobalNavMenuProps = {
  projectId?: string;
  offsetTop?: string;
};

type NavLink = {
  label: string;
  href: string;
};

function isActivePath(pathname: string, href: string) {
  return pathname === href;
}

export default function GlobalNavMenu({ projectId, offsetTop = "top-4" }: GlobalNavMenuProps) {
  const pathname = usePathname() ?? "";
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const globalLinks = useMemo<NavLink[]>(
    () => [
      { label: "Studio", href: "/studio" },
      { label: "Projects", href: "/projects" },
    ],
    [],
  );

  const projectLinks = useMemo<NavLink[]>(
    () =>
      projectId
        ? [
            { label: "Overview", href: `/projects/${projectId}` },
            { label: "Research Hub", href: `/projects/${projectId}/research-hub` },
            { label: "Creative Studio", href: `/projects/${projectId}/creative-studio` },
            { label: "Usage + Cost", href: `/projects/${projectId}/usage` },
          ]
        : [],
    [projectId],
  );

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!menuRef.current?.contains(target)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={menuRef} className={`fixed ${offsetTop} left-4 z-50`}>
      <button
        type="button"
        aria-label="Open global navigation"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-[#141416] transition-all hover:border-white/20 hover:bg-[#1c1c1e]"
      >
        <img
          src="/v-mark.png"
          alt="Victora"
          style={{ width: 36, height: 36, objectFit: "contain", display: "block", flexShrink: 0 }}
        />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-3 w-56 rounded-2xl border border-white/10 bg-[#141416] p-3 shadow-lg">
          <div className="space-y-3">
            <div className="space-y-1">
              <p className="px-2 text-label font-mono uppercase tracking-widest text-muted">
                Global
              </p>
              {globalLinks.map((link) => {
                const active = isActivePath(pathname, link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setOpen(false)}
                    className={[
                      "flex items-center rounded-inner border px-3 py-2 text-body-sm transition-all",
                      active
                        ? "border-accent/30 bg-white/5 text-white"
                        : "border-transparent text-muted hover:border-white/10 hover:bg-white/5 hover:text-white",
                    ].join(" ")}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </div>

            {projectLinks.length > 0 && (
              <div className="space-y-1 border-t border-white/10 pt-3">
                <p className="px-2 text-label font-mono uppercase tracking-widest text-muted">
                  Project
                </p>
                {projectLinks.map((link) => {
                  const active = isActivePath(pathname, link.href);
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      onClick={() => setOpen(false)}
                      className={[
                        "flex items-center rounded-inner border px-3 py-2 text-body-sm transition-all",
                        active
                          ? "border-accent/30 bg-white/5 text-white"
                          : "border-transparent text-muted hover:border-white/10 hover:bg-white/5 hover:text-white",
                      ].join(" ")}
                    >
                      {link.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
