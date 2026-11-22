import { describe, expect, it } from "vitest";
import { ProviderRegistry, runAdapterConformanceChecks } from "@/core";
import { mockProviderAdapter } from "./index";

describe("Mock Provider Adapter conformance (PRD 10.11, TC-16)", () => {
  it("passes the shared conformance suite and registers in ProviderRegistry", async () => {
    const registry = new ProviderRegistry();
    registry.register(mockProviderAdapter);
    expect(registry.get("mock")?.meta.displayName).toContain("Mock Provider");

    const report = await runAdapterConformanceChecks(mockProviderAdapter, {
      apiKey: "mock_fixture_token_999",
    });
    expect(report.passed).toBe(true);
    expect(report.checks.every((check) => check.passed)).toBe(true);
  });
});
