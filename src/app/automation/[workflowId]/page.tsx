import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft, Workflow } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";

async function WorkflowDetailContent({ params }: { params: Promise<{ workflowId: string }> }) {
  const { workflowId } = await params;

  return (
    <div className="space-y-6">
      <Link href="/automation" className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary">
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Automation
      </Link>
      <PageHeader
        title={`Workflow ${workflowId}`}
        subtitle="Structured step list and execution history (Phase 6 / P2)."
      />
      <EmptyState
        icon={Workflow}
        title="Workflow execution activates in Phase 6"
        body="Runs share the single per-minute cron tick and create traceable jobs."
      />
    </div>
  );
}

export default function WorkflowDetailPage({
  params,
}: {
  params: Promise<{ workflowId: string }>;
}) {
  return (
    <Suspense fallback={<div className="h-40 rounded-xl border border-border bg-surface" />}>
      <WorkflowDetailContent params={params} />
    </Suspense>
  );
}
