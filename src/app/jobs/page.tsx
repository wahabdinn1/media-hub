import { Suspense } from "react";
import { JobsClient } from "./jobs-client";

export default function JobsPage() {
  return (
    <Suspense fallback={<div className="h-40 rounded-xl border border-border bg-surface" />}>
      <JobsClient />
    </Suspense>
  );
}
