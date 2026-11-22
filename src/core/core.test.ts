import { describe, expect, it } from "vitest";
import { FREE_TIER_BUDGETS, GIB, redactRecord, redactUrl } from "@/shared";
import {
  AuthorizationError,
  assertScope,
  canEnqueueJob,
  canStageR2File,
  createOwnerPrincipal,
  evaluateQuotaState,
  resolveConnectionForOperation,
  type ProviderConnectionRecord,
} from "./index";

describe("Quota guardrails (PRD 14.4, TC-18, TC-19)", () => {
  it("triggers warning at 70% and degrade mode at 90% blocking uploads/bulk (TC-18)", () => {
    const warn = evaluateQuotaState({
      d1_rows_written_daily: Math.ceil(FREE_TIER_BUDGETS.d1_rows_written_daily.budget * 0.72),
    });
    expect(warn.overallLevel).toBe("warning");
    expect(warn.degradeModeActive).toBe(false);
    expect(canEnqueueJob(warn, "video.upload_url").allowed).toBe(true);

    const degraded = evaluateQuotaState({
      d1_rows_written_daily: Math.ceil(FREE_TIER_BUDGETS.d1_rows_written_daily.budget * 0.91),
    });
    expect(degraded.overallLevel).toBe("degraded");
    expect(degraded.degradeModeActive).toBe(true);
    expect(canEnqueueJob(degraded, "video.upload_url").allowed).toBe(false);
    expect(canEnqueueJob(degraded, "asset.organize", true).allowed).toBe(false);
    expect(canEnqueueJob(degraded, "asset.organize", false).allowed).toBe(true);
  });

  it("blocks all job creation when kill-switch is enabled", () => {
    const paused = evaluateQuotaState({}, { killSwitchEnabled: true });
    expect(paused.overallLevel).toBe("paused");
    expect(canEnqueueJob(paused, "asset.organize").allowed).toBe(false);
  });

  it("rejects R2 staging uploads that exceed per-file or total staging caps (TC-19)", () => {
    expect(
      canStageR2File({
        currentStagingBytes: 2.5 * GIB,
        incomingFileBytes: 0.75 * GIB,
      }).allowed,
    ).toBe(false);

    expect(
      canStageR2File({
        currentStagingBytes: 0,
        incomingFileBytes: 1.5 * GIB,
      }).allowed,
    ).toBe(false);

    expect(
      canStageR2File({
        currentStagingBytes: 1 * GIB,
        incomingFileBytes: 0.5 * GIB,
      }).allowed,
    ).toBe(true);
  });
});

describe("Provider connection routing (PRD 10.6, TC-17)", () => {
  const connections: ProviderConnectionRecord[] = [
    { id: "conn-vidara", serviceType: "video_host", providerKey: "vidara", status: "active", isDefault: true },
    { id: "conn-mock", serviceType: "video_host", providerKey: "mock", status: "active", isDefault: false },
  ];

  it("routes new work to the default connection and keeps non-default locations read-only", () => {
    const forNew = resolveConnectionForOperation({
      connections,
      serviceType: "video_host",
      mutation: true,
    });
    expect(forNew.allowed).toBe(true);
    if (forNew.allowed) {
      expect(forNew.connection.id).toBe("conn-vidara");
    }

    const readNonDefault = resolveConnectionForOperation({
      connections,
      serviceType: "video_host",
      locationConnectionId: "conn-mock",
      mutation: false,
    });
    expect(readNonDefault.allowed).toBe(true);
    if (readNonDefault.allowed) {
      expect(readNonDefault.mode).toBe("read_only");
      expect(readNonDefault.connection.id).toBe("conn-mock");
    }

    const mutateNonDefault = resolveConnectionForOperation({
      connections,
      serviceType: "video_host",
      locationConnectionId: "conn-mock",
      mutation: true,
    });
    expect(mutateNonDefault.allowed).toBe(false);
  });
});

describe("Redaction and permissions (TC-06, TC-07)", () => {
  it("redacts API keys in URL query strings and nested payloads (TC-07)", () => {
    const sanitized = redactUrl("https://api.vidara.so/v1/files?key=super-secret-key&page=1");
    expect(sanitized).toBe("https://api.vidara.so/v1/files?[REDACTED_QUERY]");
    expect(sanitized).not.toContain("super-secret-key");

    const record = redactRecord({
      apiKey: "super-secret-key",
      requestUrl: "https://api.vidara.so/v1/clone?key=super-secret-key",
      safeField: "ok",
    });
    expect(record.apiKey).toBe("[REDACTED]");
    expect(record.requestUrl).toBe("https://api.vidara.so/v1/clone?[REDACTED_QUERY]");
    expect(record.safeField).toBe("ok");
  });

  it("enforces server-side permission scope guards", () => {
    const owner = createOwnerPrincipal("owner-1", "owner@example.com");
    expect(() => assertScope(owner, "provider.manage")).not.toThrow();
    expect(() => assertScope(null, "provider.manage")).toThrow(AuthorizationError);
  });
});
