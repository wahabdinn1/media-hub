import { redactUrl } from "@/shared";
import { checkUrlSafety } from "./url-validator";

export type BulkRowStatus =
  | "valid"
  | "duplicate"
  | "invalid"
  | "unsupported"
  | "already_registered";

export interface BulkPreviewRow {
  rowNumber: number;
  rawUrl: string;
  redactedUrl: string;
  sourceUrlHash: string | null;
  title?: string;
  provider?: string;
  status: BulkRowStatus;
  error?: string;
}

export interface BulkDryRunSummary {
  total: number;
  valid: number;
  duplicate: number;
  invalid: number;
  unsupported: number;
  alreadyRegistered: number;
  rows: BulkPreviewRow[];
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

export interface ParsedBulkInputRow {
  rowNumber: number;
  url: string;
  title?: string;
  provider?: string;
}

/**
 * Parses either plain newline-separated URLs or CSV with optional headers (url, title, provider).
 * PRD BULK-01.
 */
export function parseBulkEntries(rawInput: string): ParsedBulkInputRow[] {
  const lines = rawInput
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return [];

  const firstCols = parseCsvLine(lines[0]!).map((c) => c.toLowerCase());
  const hasHeader =
    firstCols.includes("url") ||
    firstCols.includes("external_id") ||
    (firstCols.length >= 2 && firstCols[0] === "url");

  let urlIdx = 0;
  let titleIdx = 1;
  let providerIdx = 2;
  let startLine = 0;

  if (hasHeader) {
    urlIdx = Math.max(0, firstCols.findIndex((c) => c === "url" || c === "external_id"));
    titleIdx = firstCols.indexOf("title");
    providerIdx = firstCols.indexOf("provider");
    startLine = 1;
  }

  const rows: ParsedBulkInputRow[] = [];
  for (let i = startLine; i < lines.length; i += 1) {
    const line = lines[i]!;
    const cols = line.includes(",") ? parseCsvLine(line) : [line];
    const url = (cols[urlIdx] ?? "").trim();
    const title = titleIdx >= 0 ? (cols[titleIdx] ?? "").trim() || undefined : undefined;
    const provider = providerIdx >= 0 ? (cols[providerIdx] ?? "").trim() || undefined : undefined;
    rows.push({
      rowNumber: i - startLine + 1,
      url,
      title,
      provider,
    });
  }

  return rows;
}

/**
 * Builds the dry-run preview before creating any batch or job (PRD BULK-02).
 */
export async function buildBulkDryRun(params: {
  rawInput: string;
  supportedProviders: ReadonlySet<string>;
  defaultProviderKey: string;
  existingUrlHashes: ReadonlySet<string>;
}): Promise<BulkDryRunSummary> {
  const parsed = parseBulkEntries(params.rawInput);
  const seenHashes = new Set<string>();
  const rows: BulkPreviewRow[] = [];

  const counts = {
    total: parsed.length,
    valid: 0,
    duplicate: 0,
    invalid: 0,
    unsupported: 0,
    alreadyRegistered: 0,
  };

  for (const entry of parsed) {
    const redactedUrl = redactUrl(entry.url);
    const providerKey = (entry.provider || params.defaultProviderKey).toLowerCase();

    if (!entry.url) {
      counts.invalid += 1;
      rows.push({
        rowNumber: entry.rowNumber,
        rawUrl: entry.url,
        redactedUrl,
        sourceUrlHash: null,
        title: entry.title,
        provider: providerKey,
        status: "invalid",
        error: "Empty URL.",
      });
      continue;
    }

    const safety = checkUrlSafety(entry.url);
    if (!safety.ok) {
      const status: BulkRowStatus =
        safety.classification === "unsupported_protocol" ? "unsupported" : "invalid";
      if (status === "unsupported") counts.unsupported += 1;
      else counts.invalid += 1;

      rows.push({
        rowNumber: entry.rowNumber,
        rawUrl: entry.url,
        redactedUrl,
        sourceUrlHash: null,
        title: entry.title,
        provider: providerKey,
        status,
        error: safety.reason,
      });
      continue;
    }

    if (!params.supportedProviders.has(providerKey)) {
      counts.unsupported += 1;
      rows.push({
        rowNumber: entry.rowNumber,
        rawUrl: entry.url,
        redactedUrl,
        sourceUrlHash: null,
        title: entry.title,
        provider: providerKey,
        status: "unsupported",
        error: `Provider "${providerKey}" is not connected or does not support URL import.`,
      });
      continue;
    }

    const normalizedUrl = safety.parsed.toString();
    const hash = await sha256Hex(normalizedUrl);

    if (seenHashes.has(hash)) {
      counts.duplicate += 1;
      rows.push({
        rowNumber: entry.rowNumber,
        rawUrl: normalizedUrl,
        redactedUrl,
        sourceUrlHash: hash,
        title: entry.title,
        provider: providerKey,
        status: "duplicate",
        error: "Duplicate URL in this batch.",
      });
      continue;
    }
    seenHashes.add(hash);

    if (params.existingUrlHashes.has(hash)) {
      counts.alreadyRegistered += 1;
      rows.push({
        rowNumber: entry.rowNumber,
        rawUrl: normalizedUrl,
        redactedUrl,
        sourceUrlHash: hash,
        title: entry.title,
        provider: providerKey,
        status: "already_registered",
        error: "An asset with this source URL is already registered.",
      });
      continue;
    }

    counts.valid += 1;
    rows.push({
      rowNumber: entry.rowNumber,
      rawUrl: normalizedUrl,
      redactedUrl,
      sourceUrlHash: hash,
      title: entry.title,
      provider: providerKey,
      status: "valid",
    });
  }

  return { ...counts, rows };
}

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function formatBatchResultsCsv(
  items: Array<{
    jobId: string;
    status: string;
    title: string;
    assetId: string;
    errorCode: string;
    redactedUrl: string;
  }>,
): string {
  const header = "job_id,status,title,asset_id,error_code,redacted_url";
  const lines = items.map((item) =>
    [
      item.jobId,
      item.status,
      item.title,
      item.assetId,
      item.errorCode,
      item.redactedUrl,
    ]
      .map(escapeCsvCell)
      .join(","),
  );
  return [header, ...lines].join("\n");
}
