"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Minus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";
import type { ProviderAccountInfo, ProviderAdapterMeta } from "@/core";
import { getMessages } from "@/shared";
import { PageHeader } from "@/components/ui/page-header";
import { ProviderBadge } from "@/components/ui/provider-badge";
import { StatusBadge } from "@/components/ui/status-badge";

interface SanitizedConnection {
  id: string;
  serviceType: string;
  providerKey: string;
  status: string;
  isDefault: boolean;
  authType: string;
  keyVersion: number;
  lastTestedAt: string | null;
  accountInfo: ProviderAccountInfo | null;
}

interface ProvidersResponse {
  dbMode: string;
  adapters: ProviderAdapterMeta[];
  connections: SanitizedConnection[];
}

function formatBytes(bytes?: number): string {
  if (bytes === undefined) return "None";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} B`;
}

export function ProvidersClient() {
  const t = getMessages("en");
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery<ProvidersResponse>({
    queryKey: ["providers"],
    queryFn: async () => {
      const res = await fetch("/api/providers");
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Failed to load providers");
      }
      return res.json();
    },
  });

  return (
    <div className="space-y-8">
      <PageHeader
        title={t.providers.title}
        subtitle={t.providers.subtitle}
        actions={
          data?.dbMode ? (
            <StatusBadge
              label={
                data.dbMode === "cloudflare-d1"
                  ? "Cloudflare D1"
                  : data.dbMode === "cloudflare-d1-http"
                    ? "Cloudflare D1 (Hybrid)"
                    : "Local SQLite"
              }
              tone="info"
              dot
            />
          ) : null
        }
      />

      {isLoading ? (
        <div className="dusk-well flex items-center gap-2 p-6 text-sm text-text-secondary">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading provider adapters…
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl bg-danger-subtle p-4 text-sm text-danger">
          {error instanceof Error ? error.message : "Failed to load providers."}
        </div>
      ) : null}

      {data ? (
        <div className="space-y-8">
          {(data.adapters ?? []).map((adapter) => {
            const connection =
              (data.connections ?? []).find((c) => c.providerKey === adapter.key) ?? null;
            return (
              <ProviderAdapterPlate
                key={adapter.key}
                adapter={adapter}
                connection={connection}
                onChanged={() => {
                  void queryClient.invalidateQueries({ queryKey: ["providers"] });
                  void queryClient.invalidateQueries({ queryKey: ["poc-health"] });
                }}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ProviderAdapterPlate({
  adapter,
  connection,
  onChanged,
}: {
  adapter: ProviderAdapterMeta;
  connection: SanitizedConnection | null;
  onChanged: () => void;
}) {
  const t = getMessages("en");
  const cap = adapter.capabilities;

  const [values, setValues] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [rotating, setRotating] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const url = connection && rotating ? `/api/providers/${connection.id}` : "/api/providers";
      const method = connection && rotating ? "PATCH" : "POST";
      const payload =
        connection && rotating
          ? { credentials: values, testBeforeSave: true }
          : {
              providerKey: adapter.key,
              credentials: values,
              setAsDefault: true,
              testBeforeSave: true,
            };

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(json.error ?? "Failed to save credentials.");
      }
      return json;
    },
    onSuccess: () => {
      setValues({});
      setRotating(false);
      setFeedback({
        kind: "success",
        text: "Credentials verified and saved with AES-GCM encryption.",
      });
      onChanged();
    },
    onError: (err) => {
      setFeedback({
        kind: "error",
        text: err instanceof Error ? err.message : "Unable to verify credentials.",
      });
    },
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      if (!connection) throw new Error("No connection saved.");
      const res = await fetch(`/api/providers/${connection.id}/test`, { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(json.error ?? "Connection test failed.");
      }
      return json;
    },
    onSuccess: () => {
      setFeedback({ kind: "success", text: "Connection test succeeded." });
      onChanged();
    },
    onError: (err) => {
      setFeedback({
        kind: "error",
        text: err instanceof Error ? err.message : "Connection test failed.",
      });
      onChanged();
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      if (!connection) throw new Error("No connection saved.");
      const res = await fetch(`/api/providers/${connection.id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? "Failed to disconnect.");
      }
    },
    onSuccess: () => {
      setConfirmDisconnect(false);
      setRotating(false);
      setFeedback({ kind: "success", text: "Provider disconnected." });
      onChanged();
    },
    onError: (err) => {
      setFeedback({
        kind: "error",
        text: err instanceof Error ? err.message : "Failed to disconnect.",
      });
    },
  });

  const showForm = !connection || rotating;
  const allRequiredFilled = adapter.credentialFields.every(
    (f) => !f.required || Boolean(values[f.name]?.trim()),
  );

  const capabilityRows = [
    { name: "Upload input", detail: cap.uploadInput, active: cap.uploadInput !== "none" },
    { name: "Thumbnails", detail: cap.thumbnailInput, active: cap.thumbnailInput !== "none" },
    { name: "Folders", detail: cap.folders, active: cap.folders !== "none" },
    { name: "Reconciliation", detail: cap.reconciliation, active: cap.reconciliation !== "none" },
    {
      name: "Delete semantics",
      detail: `${cap.deleteSemantics.mode}${cap.deleteSemantics.restorable ? " (restorable)" : " (no restore)"}`,
      active: cap.deleteSemantics.mode !== "none",
    },
    { name: "Async encoding", detail: cap.asyncProcessing ? "Yes" : "No", active: cap.asyncProcessing },
    { name: "Removed & DMCA lists", detail: cap.removedList && cap.copyrightFlags ? "Both" : "Partial", active: cap.removedList || cap.copyrightFlags },
    { name: "Stats & Subtitles", detail: `${cap.stats ? "Stats" : "No stats"}, ${cap.subtitles ? "Subtitles" : "No subtitles"}`, active: cap.stats || cap.subtitles },
  ];

  return (
    <section className="dusk-plate overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/80 px-6 py-4">
        <div className="flex items-center gap-3.5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-subtle font-display text-sm font-semibold text-violet">
            {adapter.displayName.slice(0, 2)}
          </div>
          <div className="space-y-0.5">
            <div className="flex items-center gap-2.5">
              <h2 className="text-base font-semibold text-text-primary">{adapter.displayName}</h2>
              <ProviderBadge providerKey={adapter.key} isDefault={connection?.isDefault} />
            </div>
            <div className="tabular-nums text-xs text-text-secondary">
              <code className="font-mono">{adapter.pinnedApiHost ?? "No external host"}</code>,
              descriptor v{cap.version}
            </div>
          </div>
        </div>

        {connection ? (
          <StatusBadge
            label={connection.status === "active" ? "Connected" : "Auth error"}
            tone={connection.status === "active" ? "success" : "danger"}
            dot
          />
        ) : (
          <StatusBadge label={t.providers.notConnectedBadge} tone="neutral" />
        )}
      </div>

      <div className="grid grid-cols-1 divide-y divide-border/80 lg:grid-cols-12 lg:divide-x lg:divide-y-0">
        {/* Left 7 cols: Account telemetry + credential controls */}
        <div className="space-y-5 p-6 lg:col-span-7">
          {feedback ? (
            <div
              role="status"
              className={
                feedback.kind === "success"
                  ? "flex items-start gap-2 rounded-xl bg-success-subtle px-3.5 py-2.5 text-xs text-success"
                  : "flex items-start gap-2 rounded-xl bg-danger-subtle px-3.5 py-2.5 text-xs text-danger"
              }
            >
              {feedback.kind === "success" ? (
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              ) : (
                <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              )}
              <span>{feedback.text}</span>
            </div>
          ) : null}

          {connection && !rotating ? (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 bg-bg/50 px-4 py-3 text-xs">
                <div className="flex items-center gap-2 font-medium text-text-primary">
                  <ShieldCheck className="h-4 w-4 text-success" />
                  <span>Encrypted credential stored (key v{connection.keyVersion})</span>
                </div>
                <span className="font-mono text-text-secondary">••••••••••••</span>
              </div>

              {connection.accountInfo ? (
                <dl className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-3">
                  <div className="rounded-xl border border-border/70 bg-surface-raised/40 p-3.5">
                    <dt className="text-text-secondary">Account</dt>
                    <dd className="mt-1 truncate text-sm font-semibold text-text-primary">
                      {connection.accountInfo.accountLabel}
                    </dd>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-surface-raised/40 p-3.5">
                    <dt className="text-text-secondary">Videos</dt>
                    <dd className="mt-1 tabular-nums text-sm font-semibold text-text-primary">
                      {connection.accountInfo.videoCount !== undefined
                        ? new Intl.NumberFormat("en-US").format(connection.accountInfo.videoCount)
                        : "None"}
                    </dd>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-surface-raised/40 p-3.5">
                    <dt className="text-text-secondary">Storage used</dt>
                    <dd className="mt-1 tabular-nums text-sm font-semibold text-text-primary">
                      {formatBytes(connection.accountInfo.storageUsedBytes)}
                    </dd>
                  </div>
                </dl>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setFeedback(null);
                    testMutation.mutate();
                  }}
                  disabled={testMutation.isPending}
                  className="dusk-btn-ghost h-8 px-3.5 text-xs disabled:opacity-50"
                >
                  {testMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  Test connection
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setFeedback(null);
                    setRotating(true);
                  }}
                  className="dusk-btn-ghost h-8 px-3.5 text-xs"
                >
                  <KeyRound className="h-3.5 w-3.5" />
                  Rotate API key
                </button>

                {!confirmDisconnect ? (
                  <button
                    type="button"
                    onClick={() => setConfirmDisconnect(true)}
                    className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full bg-danger-subtle px-3.5 text-xs font-medium text-danger transition-opacity hover:opacity-90"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Disconnect
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => disconnectMutation.mutate()}
                      disabled={disconnectMutation.isPending}
                      className="inline-flex h-8 items-center whitespace-nowrap rounded-full bg-danger px-3.5 text-xs font-medium text-primary-foreground"
                    >
                      {disconnectMutation.isPending ? "Disconnecting…" : "Confirm disconnect"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDisconnect(false)}
                      className="h-8 px-2 text-xs text-text-secondary hover:text-text-primary"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {showForm ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setFeedback(null);
                saveMutation.mutate();
              }}
              className="space-y-4"
            >
              <div>
                <div className="text-sm font-medium text-text-primary">
                  {rotating ? "Rotate credentials" : "Connect account"}
                </div>
                <p className="mt-0.5 text-xs text-text-secondary">
                  {t.providers.credentialFormHint}
                </p>
              </div>

              <div className="space-y-3">
                {adapter.credentialFields.map((field) => {
                  const isSecret = field.type === "secret";
                  const isVisible = Boolean(revealed[field.name]);
                  return (
                    <div key={field.name} className="space-y-1.5">
                      <label
                        htmlFor={`${adapter.key}-${field.name}`}
                        className="block text-xs font-medium text-text-primary"
                      >
                        {field.label}
                        {field.required ? <span className="text-danger"> *</span> : null}
                      </label>
                      <div className="relative">
                        <input
                          id={`${adapter.key}-${field.name}`}
                          type={isSecret && !isVisible ? "password" : "text"}
                          autoComplete="off"
                          value={values[field.name] ?? ""}
                          onChange={(e) =>
                            setValues((prev) => ({ ...prev, [field.name]: e.target.value }))
                          }
                          placeholder={field.placeholder ?? ""}
                          className="h-10 w-full rounded-lg border border-border bg-bg pl-3.5 pr-9 font-mono text-xs text-text-primary placeholder:text-text-secondary focus:border-primary focus:outline-none"
                        />
                        {isSecret ? (
                          <button
                            type="button"
                            onClick={() =>
                              setRevealed((prev) => ({ ...prev, [field.name]: !prev[field.name] }))
                            }
                            aria-label={isVisible ? "Hide key" : "Show key"}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
                          >
                            {isVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        ) : null}
                      </div>
                      {field.helpText ? (
                        <p className="text-xs text-text-secondary">{field.helpText}</p>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="submit"
                  disabled={!allRequiredFilled || saveMutation.isPending}
                  className="dusk-btn-primary h-9 px-4 text-xs disabled:opacity-50"
                >
                  {saveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  {rotating ? "Verify & rotate key" : "Verify & save connection"}
                </button>

                {rotating ? (
                  <button
                    type="button"
                    onClick={() => {
                      setRotating(false);
                      setValues({});
                    }}
                    className="dusk-btn-ghost h-9 px-3.5 text-xs"
                  >
                    Cancel
                  </button>
                ) : null}
              </div>
            </form>
          ) : null}
        </div>

        {/* Right 5 cols: Quiet ruled capability ledger */}
        <div className="space-y-3 p-6 lg:col-span-5">
          <div className="text-xs font-medium text-text-secondary">
            {t.providers.capabilitiesHeading}
          </div>
          <ul className="divide-y divide-border/70 text-xs">
            {capabilityRows.map((row) => (
              <li key={row.name} className="flex items-center justify-between gap-3 py-2">
                <span className="flex items-center gap-2 text-text-primary">
                  {row.active ? (
                    <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                  ) : (
                    <Minus className="h-3.5 w-3.5 shrink-0 text-text-secondary" aria-hidden="true" />
                  )}
                  {row.name}
                </span>
                <span className="text-text-secondary">{row.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-6 py-3 tabular-nums text-xs text-text-secondary">
        <span>
          Rate limit: {cap.rateLimit.requestsPerWindow}/{cap.rateLimit.windowSeconds}s
        </span>
        {connection?.lastTestedAt ? (
          <span>Tested: {new Date(connection.lastTestedAt).toLocaleTimeString()}</span>
        ) : (
          <span>Not tested yet</span>
        )}
      </div>
    </section>
  );
}
