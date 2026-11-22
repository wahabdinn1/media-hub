import { describe, expect, it } from "vitest";
import { buildBulkDryRun, formatBatchResultsCsv } from "./bulk-parser";

describe("Bulk import parser & dry-run (PRD BULK-01, BULK-02, BULK-04)", () => {
  it("classifies valid, duplicate, invalid/SSRF, unsupported, and already_registered rows", async () => {
    const existing = await buildBulkDryRun({
      rawInput: "https://cdn.example.com/already.mp4",
      supportedProviders: new Set(["vidara"]),
      defaultProviderKey: "vidara",
      existingUrlHashes: new Set(),
    });
    const existingHash = existing.rows[0]!.sourceUrlHash!;

    const csv = [
      "url,title,provider",
      "https://cdn.example.com/a.mp4,Clip A,vidara",
      "https://cdn.example.com/a.mp4,Clip A Dup,vidara",
      "https://cdn.example.com/already.mp4,Already Here,vidara",
      "http://127.0.0.1/private.mp4,SSRF,vidara",
      "ftp://cdn.example.com/old.mp4,Old Proto,vidara",
      "https://cdn.example.com/b.mp4,Wrong Provider,other",
    ].join("\n");

    const preview = await buildBulkDryRun({
      rawInput: csv,
      supportedProviders: new Set(["vidara"]),
      defaultProviderKey: "vidara",
      existingUrlHashes: new Set([existingHash]),
    });

    expect(preview.total).toBe(6);
    expect(preview.valid).toBe(1);
    expect(preview.duplicate).toBe(1);
    expect(preview.alreadyRegistered).toBe(1);
    expect(preview.invalid).toBe(1);
    expect(preview.unsupported).toBe(2);
    expect(preview.rows[0]?.title).toBe("Clip A");
  });

  it("exports CSV results safely escaping commas and quotes", () => {
    const csv = formatBatchResultsCsv([
      {
        jobId: "job-1",
        status: "completed",
        title: 'My "Clip", Part 1',
        assetId: "asset-1",
        errorCode: "",
        redactedUrl: "https://cdn.example.com/a.mp4",
      },
    ]);
    expect(csv).toContain('"My ""Clip"", Part 1"');
    expect(csv).toContain("job_id,status,title,asset_id,error_code,redacted_url");
  });
});
