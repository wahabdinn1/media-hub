import {
  CanonicalAssetStatusSchema,
  CanonicalErrorSchema,
  CapabilityDescriptorSchema,
  redactRecord,
} from "@/shared";
import type { ProviderAdapter, ProviderCredentials } from "./contract";

export interface ConformanceReport {
  adapterKey: string;
  passed: boolean;
  checks: Array<{ name: string; passed: boolean; detail?: string }>;
}

export async function runAdapterConformanceChecks(
  adapter: ProviderAdapter,
  fixtureCredentials: ProviderCredentials,
): Promise<ConformanceReport> {
  const checks: Array<{ name: string; passed: boolean; detail?: string }> = [];

  const descriptorResult = CapabilityDescriptorSchema.safeParse(adapter.meta.capabilities);
  checks.push({
    name: "static_capability_descriptor_valid",
    passed: descriptorResult.success,
    detail: descriptorResult.success ? undefined : descriptorResult.error.message,
  });

  const account = await adapter.testConnection(fixtureCredentials);
  const serializedAccount = JSON.stringify(account);
  const leakedSecret = Object.values(fixtureCredentials).some(
    (secret) => secret.length >= 6 && serializedAccount.includes(secret),
  );
  checks.push({
    name: "account_info_never_leaks_credentials",
    passed: !leakedSecret && typeof account.accountLabel === "string",
    detail: leakedSecret ? "Credential value appeared in account info payload." : undefined,
  });

  const listed = await adapter.listAssets(fixtureCredentials, { page: 1, limit: 10 });
  const statusesValid = listed.items.every(
    (item) => CanonicalAssetStatusSchema.safeParse(item.canonicalStatus).success,
  );
  checks.push({
    name: "list_assets_canonical_statuses",
    passed: statusesValid,
  });

  const timeoutError = adapter.normalizeError(new Error("ETIMEDOUT upstream socket hang up"));
  const parsedError = CanonicalErrorSchema.safeParse(timeoutError);
  checks.push({
    name: "normalize_error_returns_canonical_shape",
    passed: parsedError.success && timeoutError.code === "TIMEOUT_UNKNOWN",
    detail: parsedError.success ? timeoutError.code : parsedError.error.message,
  });

  const secretToken = fixtureCredentials.apiKey ?? "secret123";
  const secretUrl = `https://example.invalid/v1/test?key=${secretToken}`;
  const redacted = redactRecord({ url: secretUrl, apiKey: secretToken });
  checks.push({
    name: "redaction_strips_query_and_secret_fields",
    passed:
      !JSON.stringify(redacted).includes(secretToken) &&
      redacted.url.includes("[REDACTED_QUERY]"),
  });

  const reconcileResult = await adapter.reconcile(fixtureCredentials, {
    jobId: "conformance-job-1",
    jobType: "video.clone",
    expectedTitle: "Conformance Sample",
    knownExternalIds: [],
    startedAt: new Date().toISOString(),
  });
  checks.push({
    name: "reconcile_returns_typed_outcome",
    passed: typeof reconcileResult.resolved === "boolean" && reconcileResult.reason.length > 0,
  });

  return {
    adapterKey: adapter.meta.key,
    passed: checks.every((c) => c.passed),
    checks,
  };
}
