import { type ReactNode } from "react";

type StatusChipVariant =
  | "default"
  | "subtle"
  | "success"
  | "danger"
  | "warning"
  | "info"
  | "running";

interface StatusChipProps {
  children: ReactNode;
  variant?: StatusChipVariant;
  className?: string;
}

const variantClasses: Record<StatusChipVariant, string> = {
  default: "border-white/9 bg-white/4 text-text",
  subtle: "border-white/9 bg-white/3 text-muted",
  success: "border-success/20 bg-success/10 text-success",
  danger: "border-danger/20 bg-danger/10 text-danger",
  warning: "border-yellow-400/20 bg-yellow-400/10 text-yellow-300",
  info: "border-accent-2/20 bg-accent-2/10 text-accent-2",
  running: "border-accent/20 bg-accent/10 text-accent animate-pulse",
};

export function StatusChip({
  children,
  variant = "default",
  className = "",
}: StatusChipProps) {
  return (
    <span
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-pill border text-label font-bold uppercase tracking-widest w-fit ${variantClasses[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
