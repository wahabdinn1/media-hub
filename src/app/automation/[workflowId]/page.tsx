import { Suspense } from "react";
import { WorkflowDetailClient } from "./workflow-detail-client";

async function WorkflowDetailContent({ params }: { params: Promise<{ workflowId: string }> }) {
  const { workflowId } = await params;
  return <WorkflowDetailClient workflowId={workflowId} />;
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
