import { Suspense } from "react";
import { AutomationClient } from "./automation-client";

export default function AutomationPage() {
  return (
    <Suspense fallback={<div className="h-48 rounded-xl border border-border bg-surface" />}>
      <AutomationClient />
    </Suspense>
  );
}
