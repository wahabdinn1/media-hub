import { Suspense } from "react";
import { LibraryClient } from "./library-client";

export default function LibraryPage() {
  return (
    <Suspense fallback={<div className="h-40 rounded-xl border border-border bg-surface" />}>
      <LibraryClient />
    </Suspense>
  );
}
