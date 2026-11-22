import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-3 rounded-xl border border-dashed border-border-strong bg-surface/60 p-6 sm:p-8",
        className,
      )}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface-raised text-text-secondary">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </div>
      <div className="max-w-lg space-y-1">
        <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
        <p className="text-sm leading-relaxed text-text-secondary">{body}</p>
      </div>
      {action ? <div className="flex flex-wrap items-center gap-2 pt-1">{action}</div> : null}
    </div>
  );
}
