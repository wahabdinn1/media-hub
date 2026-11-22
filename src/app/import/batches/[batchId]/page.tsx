import { Suspense } from "react";
import { BatchDetailClient } from "./batch-detail-client";

async function BatchDetailWrapper({ params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  return <BatchDetailClient batchId={batchId} />;
}

export default function BatchDetailPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  return (
    <Suspense fallback={<div className="h-48 rounded-xl border border-border bg-surface" />}>
      <BatchDetailWrapper params={params} />
    </Suspense>
  );
}
