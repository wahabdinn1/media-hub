import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { checkUrlSafety } from "../import/url-validator";
import { validateThumbnailUrl } from "../import/thumbnail-validator";
import { validateSubtitleUrl } from "../import/subtitle-validator";

function walkFiles(dir: string, predicate: (filePath: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full, predicate));
    } else if (predicate(full)) {
      out.push(full);
    }
  }
  return out;
}

describe("Phase 7 security and architecture invariants", () => {
  const repoRoot = path.resolve(import.meta.dirname, "../../..");

  it("enforces requireOwnerRequest on every API route handler (TC-06)", () => {
    const apiDir = path.join(repoRoot, "src/app/api");
    const routes = walkFiles(apiDir, (p) => path.basename(p) === "route.ts");
    expect(routes.length).toBeGreaterThanOrEqual(20);

    const unprotected = routes.filter((routePath) => {
      const source = fs.readFileSync(routePath, "utf8");
      return !source.includes("requireOwnerRequest");
    });

    expect(unprotected).toEqual([]);
  });

  it("forbids direct @/adapters/* imports in UI pages and components (TC-16)", () => {
    const uiDirs = [path.join(repoRoot, "src/app"), path.join(repoRoot, "src/components")];
    const uiFiles = uiDirs.flatMap((dir) =>
      walkFiles(
        dir,
        (p) =>
          (p.endsWith(".ts") || p.endsWith(".tsx")) && !p.includes(`${path.sep}api${path.sep}`),
      ),
    );

    const violations = uiFiles.filter((filePath) => {
      const source = fs.readFileSync(filePath, "utf8");
      return /from\s+["']@\/adapters\//.test(source);
    });

    expect(violations).toEqual([]);
  });

  it("blocks SSRF private/loopback/metadata/non-HTTP targets across all URL validators (TC-09)", async () => {
    const blockedUrls = [
      "http://127.0.0.1/video.mp4",
      "http://localhost:8080/internal",
      "http://169.254.169.254/latest/meta-data/",
      "http://10.0.0.5/private.mp4",
      "http://172.16.0.10/private.mp4",
      "http://192.168.1.1/private.mp4",
      "file:///etc/passwd",
      "ftp://example.com/file.mp4",
    ];

    for (const url of blockedUrls) {
      expect(checkUrlSafety(url).ok).toBe(false);
      expect((await validateThumbnailUrl(url)).valid).toBe(false);
      expect((await validateSubtitleUrl(url)).valid).toBe(false);
    }
  });
});
