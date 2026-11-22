import { describe, expect, it } from "vitest";
import { validateImportUrl } from "./url-validator";

describe("URL ingestion security & classification (PRD UP-02, 13.3, TC-01, TC-09)", () => {
  it("classifies a normal HTML web page as web_page and rejects it (TC-01)", async () => {
    const mockFetch = (async () =>
      new Response("", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      })) as typeof fetch;

    const result = await validateImportUrl("https://example.com/watch?v=12345", mockFetch);
    expect(result.valid).toBe(false);
    expect(result.classification).toBe("web_page");
    expect(result.redactedUrl).toContain("[REDACTED_QUERY]");
  });

  it("accepts a direct video file URL and extracts safe metadata (TC-02)", async () => {
    const mockFetch = (async () =>
      new Response(null, {
        status: 200,
        headers: {
          "content-type": "video/mp4",
          "content-length": "52428800",
        },
      })) as typeof fetch;

    const result = await validateImportUrl("https://cdn.example.com/clips/demo-cut.mp4?token=abc", mockFetch);
    expect(result.valid).toBe(true);
    expect(result.classification).toBe("direct_video_candidate");
    expect(result.contentLength).toBe(52428800);
    expect(result.inferredTitle).toBe("demo-cut");
    expect(result.redactedUrl).not.toContain("token=abc");
  });

  it("blocks private, loopback, link-local, metadata IPs, and non-HTTP protocols before fetching (TC-09)", async () => {
    let fetchCalled = false;
    const mockFetch = (async () => {
      fetchCalled = true;
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    const blockedUrls = [
      "http://127.0.0.1/video.mp4",
      "http://localhost:8080/video.mp4",
      "http://169.254.169.254/latest/meta-data/",
      "http://10.0.0.5/internal.mp4",
      "http://192.168.1.10/nas.mp4",
      "http://[::1]/video.mp4",
      "http://[::ffff:127.0.0.1]/video.mp4",
      "file:///etc/passwd",
      "ftp://example.com/clip.mp4",
    ];

    for (const url of blockedUrls) {
      const res = await validateImportUrl(url, mockFetch);
      expect(res.valid).toBe(false);
    }
    expect(fetchCalled).toBe(false);
  });

  it("re-validates redirect hops and blocks redirect to private metadata IP", async () => {
    const mockFetch = (async () =>
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data" },
      })) as typeof fetch;

    const res = await validateImportUrl("https://example.com/redirect.mp4", mockFetch);
    expect(res.valid).toBe(false);
    expect(res.classification).toBe("blocked_private_host");
  });
});
