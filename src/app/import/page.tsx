import { Suspense } from "react";
import { ImportClient } from "./import-client";

export default function ImportPage() {
  return (
    <Suspense fallback={<div className="h-40 rounded-xl border border-border bg-surface" />}>
      <ImportClient />
    </Suspense>
  );
}
