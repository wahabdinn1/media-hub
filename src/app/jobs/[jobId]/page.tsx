import { Suspense } from "react";
import { JobDetailClient } from "./job-detail-client";

async function JobDetailWrapper({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  return <JobDetailClient jobId={jobId} />;
}

export default function JobDetailPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  return (
    <Suspense fallback={<div className="h-48 rounded-xl border border-border bg-surface" />}>
      <JobDetailWrapper params={params} />
    </Suspense>
  );
}
