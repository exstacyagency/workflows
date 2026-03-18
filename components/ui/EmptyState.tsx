import { type ReactNode } from "react";

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  variant?: "default" | "locked" | "error";
}

const variantClasses = {
  default: "border-line/50",
  locked: "border-line/30",
  error: "border-danger/20 bg-danger/5",
};

const titleClasses = {
  default: "text-muted",
  locked: "text-muted",
  error: "text-danger",
};

export function EmptyState({
  title,
  description,
  action,
  variant = "default",
}: EmptyStateProps) {
  return (
    <div
      className={`rounded-card border p-12 text-center space-y-4 ${variantClasses[variant]}`}
    >
      <p className={`text-body-sm font-mono uppercase tracking-widest ${titleClasses[variant]}`}>
        {title}
      </p>
      {description && (
        <p className="text-body-sm text-muted max-w-md mx-auto leading-relaxed">
          {description}
        </p>
      )}
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
}
