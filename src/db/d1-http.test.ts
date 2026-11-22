import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";
import { createD1HttpClient } from "./client";

describe("Cloudflare D1 HTTP adapter for Hybrid Vercel deployment", () => {
  it("executes Drizzle queries against Cloudflare D1 HTTP API cleanly", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const mockFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body ?? "{}")) });
      return new Response(
        JSON.stringify({
          success: true,
          errors: [],
          result: [
            {
              success: true,
              results: {
                columns: ["key", "value_json", "updated_at"],
                rows: [["locale", "\"en\"", "2026-11-22T00:00:00.000Z"]],
              },
              meta: { rows_read: 1 },
            },
          ],
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const d1 = createD1HttpClient(
      {
        accountId: "acc_test_123",
        databaseId: "db_test_456",
        token: "cf_d1_test_token",
      },
      mockFetch,
    );

    const db = drizzle(d1, { schema });
    const rows = await db.select().from(schema.appSettings);
    expect(rows).toEqual([
      { key: "locale", valueJson: '"en"', updatedAt: "2026-11-22T00:00:00.000Z" },
    ]);
    expect(calls[0]?.url).toContain("/accounts/acc_test_123/d1/database/db_test_456/raw");
  });
});
