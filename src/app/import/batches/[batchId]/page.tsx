import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft, FileSpreadsheet } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";

async function BatchDetailContent({ params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;

  return (
    <div className="space-y-6">
      <Link href="/import?tab=bulk" className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary">
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Import
      </Link>
      <PageHeader
        title={`Batch ${batchId}`}
        subtitle="Batch header summary reconciled to per-item jobs (Phase 4)."
      />
      <EmptyState
        icon={FileSpreadsheet}
        title="Batch execution activates in Phase 4"
        body="Per-item status, eligible failure retry, and result CSV export live here once chunked queue dispatch is wired."
      />
    </div>
  );
}

export default function BatchDetailPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  return (
    <Suspense fallback={<div className="h-40 rounded-xl border border-border bg-surface" />}>
      <BatchDetailContent params={params} />
    </Suspense>
  );
}
