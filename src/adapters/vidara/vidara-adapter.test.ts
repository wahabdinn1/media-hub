import { describe, expect, it } from "vitest";
import { CapabilityDescriptorSchema } from "@/shared";
import { runAdapterConformanceChecks } from "@/core";
import {
  VIDARA_API_BASE_URL,
  VIDARA_CAPABILITIES,
  createVidaraAdapter,
  mapVidaraStatus,
  unwrapVidaraEnvelope,
  vidaraProviderAdapter,
} from "./index";

function createFixtureFetch(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/v1/, "");
    const key = url.searchParams.get("api_key");

    if (key !== "fake_fixture_key_for_tests_000") {
      return new Response(JSON.stringify({ msg: "Invalid key", status: 403 }), { status: 200 });
    }

    switch (path) {
      case "/user/info":
        return new Response(
          JSON.stringify({
            msg: "OK",
            status: 200,
            result: {
              username: "fixture_owner",
              email: "owner@example.invalid",
              premium: "expired",
              storage_left: "unlimited",
              storage_used: 392554,
              videos_total: 2,
            },
          }),
          { status: 200 },
        );
      case "/video/list": {
        const titleFilter = url.searchParams.get("title") ?? "";
        const all = [
          {
            vid_id: 101,
            filecode: "fxCode001",
            title: "Launch Walkthrough",
            thumbnail: "https://vidara.so/thumb1.jpg",
            length: "120",
            link: "https://vidara.so/fxCode001",
            views: 42,
            uploaded: "2026-11-20",
            status: "active",
            file_active: 1,
          },
          {
            vid_id: 102,
            filecode: "fxCode002",
            title: "Cloned Clip",
            thumbnail: "https://vidara.so/thumb2.jpg",
            length: "60",
            link: "https://vidara.so/fxCode002",
            views: 0,
            uploaded: "2026-11-22",
            status: "active",
            file_active: 1,
          },
        ];
        const filtered = titleFilter
          ? all.filter((v) => v.title.toLowerCase().includes(titleFilter.toLowerCase()))
          : all;
        return new Response(
          JSON.stringify({
            msg: "OK",
            status: 200,
            result: { videos: filtered, page: 1, total_pages: 1, total: filtered.length },
          }),
          { status: 200 },
        );
      }
      case "/video/status":
        return new Response(
          JSON.stringify({
            msg: "OK",
            status: 200,
            result: {
              encodings: [{ filecode: "fxCode001", progress_percentage: "42%" }],
              total: 1,
            },
          }),
          { status: 200 },
        );
      case "/upload/url":
        return new Response(
          JSON.stringify({
            msg: "OK",
            status: 200,
            data: { filecode: "fxUploaded1", title: "clip.mp4", size: 52428800 },
          }),
          { status: 200 },
        );
      default:
        return new Response(JSON.stringify({ msg: "OK", status: 200, result: {} }), { status: 200 });
    }
  }) as typeof fetch;
}

describe("Vidara adapter contract & conformance (PRD 12.6, TC-11, TC-12)", () => {
  it("validates static capability descriptor and pinned API host", () => {
    expect(VIDARA_API_BASE_URL).toBe("https://api.vidara.so/v1");
    expect(CapabilityDescriptorSchema.parse(VIDARA_CAPABILITIES).deleteSemantics).toEqual({
      mode: "soft",
      restorable: false,
    });
  });

  it("passes the shared conformance suite using fixture transport", async () => {
    const adapter = createVidaraAdapter(createFixtureFetch());
    const report = await runAdapterConformanceChecks(adapter, {
      apiKey: "fake_fixture_key_for_tests_000",
    });
    expect(report.passed).toBe(true);
    expect(report.checks.every((c) => c.passed)).toBe(true);
  });

  it("normalizes result, data, and flat upload envelopes (TC-11)", () => {
    expect(unwrapVidaraEnvelope<{ filecode: string }>({ result: { filecode: "abc" } })).toEqual({
      filecode: "abc",
    });
    expect(unwrapVidaraEnvelope<{ filecode: string }>({ data: { filecode: "def" } })).toEqual({
      filecode: "def",
    });
    expect(unwrapVidaraEnvelope<{ filecode: string }>({ filecode: "ghi" })).toEqual({
      filecode: "ghi",
    });
  });

  it("maps encoding progress and reconciles a single unambiguous clone by diff (TC-12, TC-14)", async () => {
    const adapter = createVidaraAdapter(createFixtureFetch());
    const creds = { apiKey: "fake_fixture_key_for_tests_000" };

    const enc = await adapter.getProcessingStatus!(creds, "fxCode001");
    expect(enc.progressPercent).toBe(42);
    expect(enc.completed).toBe(false);
    expect(enc.canonicalStatus).toBe("processing");

    const reconciled = await adapter.reconcile(creds, {
      jobId: "job-clone-1",
      jobType: "video.clone",
      expectedTitle: "Cloned Clip",
      knownExternalIds: ["fxCode001"],
      startedAt: new Date().toISOString(),
    });
    expect(reconciled.resolved).toBe(true);
    expect(reconciled.externalId).toBe("fxCode002");
  });

  it("maps encoding progress below 100% and redacts secrets in errors (TC-07)", () => {
    expect(mapVidaraStatus("active", 42)).toBe("processing");
    expect(mapVidaraStatus("active", 100)).toBe("active");
    expect(mapVidaraStatus("dmca")).toBe("dmca");

    const err = vidaraProviderAdapter.normalizeError(
      new Error("ETIMEDOUT https://api.vidara.so/v1/video/clone?api_key=secret-key-xyz"),
    );
    expect(err.code).toBe("TIMEOUT_UNKNOWN");
    expect(err.retryable).toBe(false);
    expect(err.message).not.toContain("secret-key-xyz");
  });
});
