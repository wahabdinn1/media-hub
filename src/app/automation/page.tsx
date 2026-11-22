import { Workflow } from "lucide-react";
import { getMessages } from "@/shared";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";

export default function AutomationPage() {
  const t = getMessages("en");

  return (
    <div className="space-y-6">
      <PageHeader title={t.automation.title} subtitle={t.automation.subtitle} />
      <EmptyState
        icon={Workflow}
        title={t.automation.emptyTitle}
        body={t.automation.emptyBody}
      />
    </div>
  );
}
