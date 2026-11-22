import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft, Film } from "lucide-react";
import { getMessages } from "@/shared";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";

async function AssetDetailContent({ params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  const t = getMessages("en");
  const tabs = [
    t.library.detailTabs.overview,
    t.library.detailTabs.provider,
    t.library.detailTabs.thumbnail,
    t.library.detailTabs.subtitles,
    t.library.detailTabs.history,
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-xs text-text-secondary">
        <Link href="/library" className="inline-flex items-center gap-1 hover:text-text-primary">
          <ArrowLeft className="h-3.5 w-3.5" />
          {t.library.title}
        </Link>
      </div>

      <PageHeader
        title={`Asset ${assetId}`}
        subtitle="Provider-neutral asset detail with isolated Provider, Thumbnail, Subtitles, and History tabs."
      />

      <div className="flex flex-wrap gap-1.5 border-b border-border pb-2">
        {tabs.map((tab, idx) => (
          <span
            key={tab}
            className={
              idx === 0
                ? "rounded-md bg-primary-subtle px-3 py-1.5 text-xs font-medium text-primary"
                : "rounded-md px-3 py-1.5 text-xs font-medium text-text-secondary"
            }
          >
            {tab}
          </span>
        ))}
      </div>

      <EmptyState
        icon={Film}
        title="Asset registry binds to Cloudflare D1 in Phase 1 & 3"
        body="Universal MediaHub asset records, provider locations, native/custom thumbnails, and history load here once D1 migrations are active."
      />
    </div>
  );
}

export default function AssetDetailPage({
  params,
}: {
  params: Promise<{ assetId: string }>;
}) {
  return (
    <Suspense fallback={<div className="h-40 rounded-xl border border-border bg-surface" />}>
      <AssetDetailContent params={params} />
    </Suspense>
  );
}
