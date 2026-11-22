import { describe, expect, it } from "vitest";
import { validateSubtitleUrl } from "./subtitle-validator";

describe("validateSubtitleUrl", () => {
  it("accepts a direct VTT subtitle file over HTTPS", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(null, {
        status: 200,
        headers: {
          "content-type": "text/vtt; charset=utf-8",
          "content-length": "4096",
        },
      });

    const result = await validateSubtitleUrl("https://cdn.example.com/subs/en.vtt", "vtt", fakeFetch);
    expect(result.valid).toBe(true);
    expect(result.detectedFormat).toBe("vtt");
  });

  it("rejects private/loopback SSRF targets and HTML pages", async () => {
    const ssrf = await validateSubtitleUrl("http://127.0.0.1/subs.srt");
    expect(ssrf.valid).toBe(false);

    const htmlFetch: typeof fetch = async () =>
      new Response("<html></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    const html = await validateSubtitleUrl("https://example.com/sub-page", "srt", htmlFetch);
    expect(html.valid).toBe(false);
    expect(html.reason).toContain("HTML");
  });
});
