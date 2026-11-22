import { describe, expect, it } from "vitest";
import { computeNextWorkflowRunAt, CreateWorkflowInputSchema } from "./workflow-schema";

describe("workflow-schema", () => {
  it("validates structured sequential steps and computes next schedule", () => {
    const parsed = CreateWorkflowInputSchema.parse({
      name: "Daily catalog sync",
      triggerType: "interval_daily",
      steps: [{ id: "step-1", type: "sync_provider", maxPages: 2 }],
    });
    expect(parsed.steps).toHaveLength(1);

    const base = new Date("2026-11-22T00:00:00.000Z");
    expect(computeNextWorkflowRunAt("manual", base)).toBeNull();
    expect(computeNextWorkflowRunAt("interval_hourly", base)).toBe("2026-11-22T01:00:00.000Z");
    expect(computeNextWorkflowRunAt("interval_daily", base)).toBe("2026-11-23T00:00:00.000Z");
  });
});
