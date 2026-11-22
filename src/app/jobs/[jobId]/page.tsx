import { Suspense } from "react";
import Link from "next/link";
import { Activity, ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";

async function JobDetailContent({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;

  return (
    <div className="space-y-6">
      <Link href="/jobs" className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary">
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Jobs
      </Link>
      <PageHeader
        title={`Job ${jobId}`}
        subtitle="Redacted payload summary, provider processing progress, reconciliation actions, and event timeline."
      />
      <EmptyState
        icon={Activity}
        title="Job timeline activates in Phase 3 & 4"
        body="Jobs with unclear outcomes surface plain-language reconciliation actions before any retry."
      />
    </div>
  );
}

export default function JobDetailPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  return (
    <Suspense fallback={<div className="h-40 rounded-xl border border-border bg-surface" />}>
      <JobDetailContent params={params} />
    </Suspense>
  );
}
