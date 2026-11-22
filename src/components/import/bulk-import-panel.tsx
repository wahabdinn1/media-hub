"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  Upload,
  XCircle,
} from "lucide-react";
import type { BulkDryRunSummary, BulkRowStatus } from "@/core";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";
import {
  DestinationSelector,
  type UploadDestinationState,
} from "@/components/import/destination-selector";

interface DryRunResponse {
  preview: BulkDryRunSummary;
  defaultProviderKey: string;
  hasConnectedProvider: boolean;
}

interface ExecuteBulkResponse {
  batch: { id: string; status: string; totalCount: number };
  jobCount: number;
  initialTick: { dispatched: number; deferredCount: number };
}

function rowTone(status: BulkRowStatus): BadgeTone {
  switch (status) {
    case "valid":
      return "success";
    case "duplicate":
    case "already_registered":
      return "warning";
    case "invalid":
    case "unsupported":
      return "danger";
  }
}

export function BulkImportPanel() {
  const queryClient = useQueryClient();
  const [rawInput, setRawInput] = useState("");
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [destination, setDestination] = useState<UploadDestinationState>({
    providerConnectionIds: [],
    folderByConnectionId: {},
    collectionIds: [],
  });
  const [dryRun, setDryRun] = useState<DryRunResponse | null>(null);
  const [created, setCreated] = useState<ExecuteBulkResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const scrollParentRef = useRef<HTMLDivElement>(null);
  const rows = dryRun?.preview.rows ?? [];

  // TanStack Virtual scoped strictly to bulk preview list (PRD 7.3)
  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => 48,
    overscan: 8,
  });

  const dryRunMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/import/bulk/dry-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawInput }),
      });
      const json = (await res.json().catch(() => ({}))) as DryRunResponse & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Dry-run failed.");
      return json;
    },
    onSuccess: (res) => {
      setDryRun(res);
      setCreated(null);
      setErrorMsg(null);
    },
    onError: (err) => {
      setErrorMsg(err instanceof Error ? err.message : "Dry-run failed.");
    },
  });

  const executeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/import/bulk/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawInput,
          rightsConfirmed,
          providerConnectionIds: destination.providerConnectionIds,
          folderByConnectionId: destination.folderByConnectionId,
          collectionIds: destination.collectionIds,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as ExecuteBulkResponse & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Batch creation failed.");
      return json;
    },
    onSuccess: (res) => {
      setCreated(res);
      setErrorMsg(null);
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["assets"] });
    },
    onError: (err) => {
      setErrorMsg(err instanceof Error ? err.message : "Batch creation failed.");
    },
  });

  async function handleCsvFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setRawInput(text);
    setDryRun(null);
    setCreated(null);
    setErrorMsg(null);
  }

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-medium text-text-primary">Paste URLs or upload CSV</h2>
              <p className="mt-0.5 text-xs text-text-secondary">
                One URL per line, or CSV with <code className="font-mono">url,title,provider</code>.
                Dry-run runs before any job is created.
              </p>
            </div>

            <label className="dusk-btn-ghost h-8 cursor-pointer px-3 text-xs">
              <Upload className="h-3.5 w-3.5" />
              Load CSV file
              <input
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                onChange={(e) => void handleCsvFile(e)}
                className="hidden"
              />
            </label>
          </div>

          <textarea
            rows={7}
            value={rawInput}
            onChange={(e) => {
              setRawInput(e.target.value);
              setDryRun(null);
              setCreated(null);
              setErrorMsg(null);
            }}
            placeholder={
              "url,title\nhttps://cdn.example.com/clip-1.mp4,Clip 1\nhttps://cdn.example.com/clip-2.mp4,Clip 2"
            }
            className="w-full rounded-xl border border-border bg-surface p-3.5 font-mono text-xs text-text-primary placeholder:text-text-secondary focus:border-primary focus:outline-none"
          />

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={!rawInput.trim() || dryRunMutation.isPending}
              onClick={() => dryRunMutation.mutate()}
              className="dusk-btn-ghost h-9 px-4 text-xs disabled:opacity-50"
            >
              {dryRunMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileSpreadsheet className="h-3.5 w-3.5" />
              )}
              Run dry-run preview
            </button>
          </div>

          {errorMsg ? (
            <div className="flex items-start gap-2 rounded-xl bg-danger-subtle p-3.5 text-xs text-danger">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          ) : null}
        </div>

        <div className="lg:col-span-5">
          <DestinationSelector value={destination} onChange={setDestination} />
        </div>
      </div>

      {dryRun ? (
        <section className="space-y-4 border-t border-border pt-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-medium text-text-primary">
              Dry-run preview ({dryRun.preview.total} rows)
            </h3>
            <div className="flex flex-wrap gap-1.5">
              <StatusBadge label={`Valid: ${dryRun.preview.valid}`} tone="success" />
              <StatusBadge label={`Duplicate: ${dryRun.preview.duplicate}`} tone="warning" />
              <StatusBadge
                label={`Already registered: ${dryRun.preview.alreadyRegistered}`}
                tone="warning"
              />
              <StatusBadge label={`Invalid: ${dryRun.preview.invalid}`} tone="danger" />
              <StatusBadge label={`Unsupported: ${dryRun.preview.unsupported}`} tone="danger" />
            </div>
          </div>

          <div
            ref={scrollParentRef}
            className="max-h-80 overflow-y-auto border-y border-border"
          >
            <div
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                width: "100%",
                position: "relative",
              }}
            >
              {rowVirtualizer.getVirtualItems().map((vRow) => {
                const row = rows[vRow.index]!;
                return (
                  <div
                    key={vRow.key}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: `${vRow.size}px`,
                      transform: `translateY(${vRow.start}px)`,
                    }}
                    className="flex items-center justify-between gap-3 border-b border-border/70 px-2 text-xs"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="w-7 shrink-0 tabular-nums text-text-secondary">
                        #{row.rowNumber}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate font-mono text-text-primary">
                          {row.title ? `${row.title}: ${row.redactedUrl}` : row.redactedUrl}
                        </div>
                        {row.error ? (
                          <div className="truncate text-xs text-danger">{row.error}</div>
                        ) : null}
                      </div>
                    </div>
                    <StatusBadge
                      label={row.status.replace(/_/g, " ")}
                      tone={rowTone(row.status)}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {dryRun.preview.valid > 0 ? (
            <div className="space-y-3 pt-2">
              <label className="flex items-start gap-2.5 text-xs text-text-secondary">
                <input
                  type="checkbox"
                  checked={rightsConfirmed}
                  onChange={(e) => setRightsConfirmed(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-primary"
                />
                <span>
                  I confirm I own or am authorized to manage all {dryRun.preview.valid} valid media
                  item(s) in this batch.
                </span>
              </label>

              <button
                type="button"
                disabled={
                  !rightsConfirmed ||
                  destination.providerConnectionIds.length === 0 ||
                  executeMutation.isPending
                }
                onClick={() => executeMutation.mutate()}
                className="dusk-btn-primary h-10 px-5 text-xs disabled:opacity-50"
              >
                {executeMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                Create batch (
                {dryRun.preview.valid * Math.max(1, destination.providerConnectionIds.length)} jobs)
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {created ? (
        <div className="dusk-well space-y-2.5 p-5 text-xs text-text-primary">
          <div className="flex items-center gap-2 font-semibold text-success">
            <CheckCircle2 className="h-4 w-4" />
            Batch created with {created.jobCount} job(s)
          </div>
          <div className="tabular-nums text-text-secondary">
            Initial chunk dispatched: {created.initialTick.dispatched}, remaining queued:{" "}
            {created.initialTick.deferredCount} (processed by 1-minute cron tick)
          </div>
          <div className="pt-1">
            <Link
              href={`/import/batches/${created.batch.id}`}
              className="dusk-btn-primary h-8 px-4 text-xs"
            >
              Open batch monitor
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
