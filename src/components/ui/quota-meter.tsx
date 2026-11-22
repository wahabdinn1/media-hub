import type { QuotaMeterSnapshot } from "@/core";
import { getMessages } from "@/shared";
import { cn } from "@/lib/cn";

function formatValue(value: number, unit: "count" | "bytes"): string {
  if (unit === "bytes") {
    if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GiB`;
    if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MiB`;
    return `${value} B`;
  }
  return new Intl.NumberFormat("en-US").format(value);
}

export function QuotaMeter({ meter }: { meter: QuotaMeterSnapshot }) {
  const t = getMessages("en");
  const barColor =
    meter.level === "degraded"
      ? "bg-danger"
      : meter.level === "warning"
        ? "bg-warning"
        : "bg-primary";

  return (
    <div className="space-y-1.5 rounded-lg border border-border bg-surface p-3">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium text-text-primary">{t.quotas.metrics[meter.metric]}</span>
        <span className="font-mono text-text-secondary">
          {formatValue(meter.used, meter.unit)} / {formatValue(meter.budget, meter.unit)}
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-raised"
        role="progressbar"
        aria-valuenow={meter.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t.quotas.metrics[meter.metric]}
      >
        <div
          className={cn("h-full w-full origin-left rounded-full transition-transform duration-200", barColor)}
          style={{ transform: `scaleX(${Math.max(meter.percent, meter.used > 0 ? 2 : 0) / 100})` }}
        />
      </div>
      <div className="flex items-center justify-between text-[11px] text-text-secondary">
        <span>Hard cap: {formatValue(meter.hardLimit, meter.unit)}</span>
        <span className="font-mono">{meter.percent}%</span>
      </div>
    </div>
  );
}
