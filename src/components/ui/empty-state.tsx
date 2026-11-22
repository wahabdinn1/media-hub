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
    <div className={cn("dusk-plate flex flex-col items-start gap-4 p-6 sm:p-8", className)}>
      <div className="flex items-center gap-3.5">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-subtle text-primary">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-text-primary">{title}</h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-text-secondary">{body}</p>
        </div>
      </div>
      {action ? <div className="flex flex-wrap items-center gap-2.5 pt-1">{action}</div> : null}
    </div>
  );
}
