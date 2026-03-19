import { type ReactNode } from "react";
import { SectionCard } from "./SectionCard";

interface SectionLinkCardProps {
  eyebrow: string;
  description: string;
  status: string;
  action: ReactNode;
  className?: string;
  sectionShell?: boolean;
}

export function SectionLinkCard({
  eyebrow,
  description,
  status,
  action,
  className = "",
  sectionShell = false,
}: SectionLinkCardProps) {
  if (sectionShell) {
    return (
      <div className={`space-y-6 ${className}`}>
        <div className="flex items-center justify-between border-b border-line pb-4">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <p className="text-body-sm font-mono text-muted uppercase tracking-widest">
              {description}
            </p>
          </div>
        </div>
        <SectionCard>
          <div className="flex items-center justify-between gap-4">
            <p className="app-status-line">{status}</p>
            {action}
          </div>
        </SectionCard>
      </div>
    );
  }

  return (
    <SectionCard className={`space-y-3 ${className}`}>
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <p className="text-sm text-muted mt-1 italic">{description}</p>
      </div>
      <div className="flex items-center justify-between gap-4">
        <p className="app-status-line">{status}</p>
        {action}
      </div>
    </SectionCard>
  );
}
