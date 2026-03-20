import { SectionCard } from "./SectionCard";

interface LoadingStateProps {
  title: string;
  description?: string;
  variant?: "page" | "section" | "inline";
  minHeightClassName?: string;
  className?: string;
}

export function LoadingState({
  title,
  description,
  variant = "section",
  minHeightClassName,
  className = "",
}: LoadingStateProps) {
  const body = (
    <div className="flex flex-col items-center gap-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-line bg-bg-elevated/80 shadow-panel">
        <img
          src="/v-mark.png"
          alt="Victora"
          className="h-8 w-8 object-contain animate-pulse"
        />
      </div>
      <div className="space-y-2">
        <p className="text-label font-mono uppercase tracking-[0.3em] text-accent">
          Loading
        </p>
        <p className="text-body-sm font-mono uppercase tracking-[0.22em] text-muted animate-pulse">
          {title}
        </p>
        {description ? (
          <p className="mx-auto max-w-md text-body-sm leading-relaxed text-muted/80">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );

  if (variant === "page") {
    return (
      <div className={`min-h-screen bg-bg px-8 py-8 text-white ${className}`.trim()}>
        <div className={`flex items-center justify-center ${minHeightClassName ?? "min-h-[60vh]"}`}>
          <SectionCard className="w-full max-w-xl text-center" padding="lg">
            {body}
          </SectionCard>
        </div>
      </div>
    );
  }

  if (variant === "inline") {
    return (
      <div className={`flex items-center justify-center ${minHeightClassName ?? "py-16"} ${className}`.trim()}>
        {body}
      </div>
    );
  }

  return (
    <div className={`flex items-center justify-center ${minHeightClassName ?? "min-h-[40vh]"} ${className}`.trim()}>
      <SectionCard className="w-full max-w-xl text-center" padding="lg">
        {body}
      </SectionCard>
    </div>
  );
}
