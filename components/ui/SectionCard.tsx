import { type ReactNode } from "react";

interface SectionCardProps {
  children: ReactNode;
  className?: string;
  padding?: "sm" | "md" | "lg" | "none";
}

const paddingClasses = {
  none: "",
  sm: "p-4",
  md: "p-6",
  lg: "p-8",
};

export function SectionCard({
  children,
  className = "",
  padding = "md",
}: SectionCardProps) {
  return (
    <div
      className={`rounded-card border border-line bg-panel shadow-panel backdrop-blur-panel ${paddingClasses[padding]} ${className}`}
    >
      {children}
    </div>
  );
}
