import { type ReactNode } from "react";

interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  backHref?: string;
  backLabel?: string;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  backHref,
  backLabel = "Back",
}: PageHeaderProps) {
  return (
    <div className="space-y-4">
      {backHref && (
        <a
          href={backHref}
          className="text-label font-mono text-muted hover:text-white uppercase tracking-widest transition-colors inline-block"
        >
          ← {backLabel}
        </a>
      )}
      <div className="flex items-start justify-between gap-6">
        <div className="space-y-2">
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h1 className="text-3xl font-bold text-white tracking-tight">
            {title}
          </h1>
          {description && (
            <p className="text-body-sm text-muted leading-relaxed">
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex items-center gap-3 shrink-0">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
