import { Suspense } from "react";
import { ProvidersClient } from "./providers-client";

export default function ProvidersPage() {
  return (
    <Suspense fallback={<div className="h-48 rounded-xl border border-border bg-surface" />}>
      <ProvidersClient />
    </Suspense>
  );
}
