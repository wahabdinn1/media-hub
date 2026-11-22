import { describe, expect, it } from "vitest";
import { R2_ITEM_CAPS } from "@/shared";
import { validateThumbnailUrl } from "./thumbnail-validator";

describe("Custom thumbnail URL validation (PRD TH-02, 13.3)", () => {
  it("accepts valid JPG/PNG/WebP image URLs under 5 MiB", async () => {
    const mockFetch = (async () =>
      new Response(null, {
        status: 200,
        headers: {
          "content-type": "image/webp",
          "content-length": "250000",
        },
      })) as typeof fetch;

    const res = await validateThumbnailUrl("https://cdn.example.com/thumb.webp?sig=secret", mockFetch);
    expect(res.valid).toBe(true);
    expect(res.contentType).toBe("image/webp");
    expect(res.redactedUrl).not.toContain("sig=secret");
  });

  it("rejects images larger than 5 MiB, non-images, and private hosts", async () => {
    const oversizedFetch = (async () =>
      new Response(null, {
        status: 200,
        headers: {
          "content-type": "image/png",
          "content-length": String(R2_ITEM_CAPS.maxCustomThumbnailBytes + 1),
        },
      })) as typeof fetch;
    expect((await validateThumbnailUrl("https://cdn.example.com/huge.png", oversizedFetch)).valid).toBe(false);

    const htmlFetch = (async () =>
      new Response(null, {
        status: 200,
        headers: { "content-type": "text/html" },
      })) as typeof fetch;
    expect((await validateThumbnailUrl("https://cdn.example.com/page", htmlFetch)).valid).toBe(false);

    let called = false;
    const neverFetch = (async () => {
      called = true;
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    expect((await validateThumbnailUrl("http://127.0.0.1/thumb.jpg", neverFetch)).valid).toBe(false);
    expect(called).toBe(false);
  });
});
