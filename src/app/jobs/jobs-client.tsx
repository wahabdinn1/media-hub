"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Activity, ScrollText } from "lucide-react";
import { getMessages } from "@/shared";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";

export function JobsClient() {
  const searchParams = useSearchParams();
  const activeTab = searchParams.get("tab") === "activity" ? "activity" : "jobs";
  const t = getMessages("en");

  return (
    <div className="space-y-6">
      <PageHeader
        title={t.jobs.title}
        subtitle={t.jobs.subtitle}
        actions={
          <div className="inline-flex rounded-lg border border-border bg-surface p-0.5 text-xs font-medium">
            <Link
              href="/jobs"
              className={cn(
                "rounded-md px-3 py-1.5",
                activeTab === "jobs"
                  ? "bg-surface-raised text-text-primary"
                  : "text-text-secondary hover:text-text-primary",
              )}
            >
              {t.jobs.tabJobs}
            </Link>
            <Link
              href="/jobs?tab=activity"
              className={cn(
                "rounded-md px-3 py-1.5",
                activeTab === "activity"
                  ? "bg-surface-raised text-text-primary"
                  : "text-text-secondary hover:text-text-primary",
              )}
            >
              {t.jobs.tabActivity}
            </Link>
          </div>
        }
      />

      {activeTab === "activity" ? (
        <EmptyState
          icon={ScrollText}
          title={t.jobs.activityEmptyTitle}
          body={t.jobs.activityEmptyBody}
        />
      ) : (
        <EmptyState
          icon={Activity}
          title={t.jobs.emptyTitle}
          body={t.jobs.emptyBody}
        />
      )}
    </div>
  );
}
