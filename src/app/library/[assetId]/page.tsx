import { Suspense } from "react";
import { AssetDetailClient } from "./asset-detail-client";

async function AssetDetailWrapper({ params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  return <AssetDetailClient assetId={assetId} />;
}

export default function AssetDetailPage({
  params,
}: {
  params: Promise<{ assetId: string }>;
}) {
  return (
    <Suspense fallback={<div className="h-48 rounded-xl border border-border bg-surface" />}>
      <AssetDetailWrapper params={params} />
    </Suspense>
  );
}
