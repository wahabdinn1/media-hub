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
    <div className={cn("dusk-well flex flex-col items-start gap-3 px-6 py-8 sm:px-8", className)}>
      <div className="flex items-center gap-2.5 text-text-primary">
        <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <h2 className="text-base font-medium text-text-primary">{title}</h2>
      </div>
      <p className="max-w-lg text-sm leading-relaxed text-text-secondary">{body}</p>
      {action ? <div className="flex flex-wrap items-center gap-2.5 pt-1">{action}</div> : null}
    </div>
  );
}
