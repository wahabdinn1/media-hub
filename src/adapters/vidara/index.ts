import {
  redactUrl,
  type CanonicalAssetStatus,
  type CanonicalError,
  type CapabilityDescriptor,
} from "@/shared";
import type {
  ListAssetsQuery,
  ListAssetsResult,
  NormalizedProviderAsset,
  ProcessingStatusResult,
  ProviderAccountInfo,
  ProviderAdapter,
  ProviderCredentials,
  ProviderFolder,
  ProviderStatsPoint,
  ReconcileInput,
  ReconcileOutcome,
  UploadResult,
} from "@/core";

/**
 * Pinned Vidara API host verified against https://vidara.to/api (PRD section 12.6).
 * Never copy documentation sample keys into code or fixtures.
 */
export const VIDARA_API_BASE_URL = "https://api.vidara.so/v1";

export const VIDARA_CAPABILITIES: CapabilityDescriptor = {
  version: "1.1.0",
  idempotency: "none",
  reconciliation: "diff",
  uploadInput: "both",
  thumbnailInput: "url",
  pagination: {
    style: "page",
    maxPageSize: 200,
  },
  listFilters: {
    title: true,
    folder: true,
    status: true,
    updatedSince: false,
  },
  folders: "flat",
  deleteSemantics: {
    mode: "soft",
    restorable: false,
  },
  clone: true,
  rename: true,
  asyncProcessing: true,
  removedList: true,
  copyrightFlags: true,
  stats: true,
  subtitles: true,
  rateLimit: {
    requestsPerWindow: 30,
    windowSeconds: 60,
    burst: 5,
  },
  limits: {
    maxFileSizeBytes: null,
    acceptedMimeTypes: ["video/mp4", "video/x-matroska", "video/webm", "video/quicktime"],
    maxTitleLength: 255,
  },
};

export function unwrapVidaraEnvelope<T>(raw: unknown): T {
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if ("result" in obj && obj.result !== undefined) {
      return obj.result as T;
    }
    if ("data" in obj && obj.data !== undefined) {
      return obj.data as T;
    }
  }
  return raw as T;
}

export function mapVidaraStatus(
  rawStatus: string | undefined,
  encodingPercent?: number,
): CanonicalAssetStatus {
  if (typeof encodingPercent === "number" && encodingPercent < 100) {
    return "processing";
  }
  switch ((rawStatus ?? "").toLowerCase()) {
    case "active":
      return "active";
    case "blocked":
      return "blocked";
    case "error":
      return "error";
    case "deleted":
    case "removed":
      return "removed_remote";
    case "dmca":
      return "dmca";
    default:
      return "processing";
  }
}

class VidaraApiError extends Error {
  readonly httpStatus?: number;
  readonly providerStatus?: number;
  readonly providerMessage?: string;

  constructor(message: string, opts?: { httpStatus?: number; providerStatus?: number; providerMessage?: string }) {
    super(redactUrl(message));
    this.name = "VidaraApiError";
    this.httpStatus = opts?.httpStatus;
    this.providerStatus = opts?.providerStatus;
    this.providerMessage = opts?.providerMessage;
  }
}

type FetchLike = typeof fetch;

function requireApiKey(credentials: ProviderCredentials): string {
  const key = credentials.apiKey?.trim().replace(/^["']|["']$/g, "");
  if (!key) {
    throw new VidaraApiError("Missing Vidara API key.", { httpStatus: 401 });
  }
  return key;
}

function parseOptionalNumber(val: unknown): number | undefined {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val === "string" && val.trim() !== "") {
    const num = Number(val.replace(/%$/, "").trim());
    if (Number.isFinite(num)) return num;
  }
  return undefined;
}

export function createVidaraAdapter(fetchImpl: FetchLike = fetch): ProviderAdapter {
  async function callVidara<T>(
    credentials: ProviderCredentials,
    path: string,
    params: Record<string, string | number | undefined> = {},
  ): Promise<T> {
    const apiKey = requireApiKey(credentials);
    const url = new URL(`${VIDARA_API_BASE_URL}${path}`);
    url.searchParams.set("api_key", apiKey);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") {
        url.searchParams.set(k, String(v));
      }
    }

    let response: Response;
    try {
      // PRD 12.6 rule 1: never cache, prefetch, or auto-retry side-effecting GET calls
      response = await fetchImpl(url.toString(), {
        method: "GET",
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      const msg = err instanceof Error ? redactUrl(err.message) : "Network error";
      const isTimeout =
        (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) ||
        /timeout|etimedout|abort/i.test(msg);
      throw new VidaraApiError(
        isTimeout ? `ETIMEDOUT calling ${redactUrl(url.toString())}` : `Network error calling ${redactUrl(url.toString())}: ${msg}`,
      );
    }

    const rawText = await response.text();
    let rawJson: unknown = null;
    try {
      rawJson = rawText ? JSON.parse(rawText) : null;
    } catch {
      const safeSnippet = redactUrl(rawText.replace(apiKey, "[REDACTED]").trim().slice(0, 120));
      throw new VidaraApiError(
        `Non-JSON response (${response.status}): ${safeSnippet || "empty body"}`,
        { httpStatus: response.status, providerMessage: safeSnippet || undefined },
      );
    }

    const envelope = rawJson && typeof rawJson === "object" ? (rawJson as Record<string, unknown>) : null;
    const providerStatus = parseOptionalNumber(envelope?.status);
    const providerMsg = typeof envelope?.msg === "string" ? envelope.msg : undefined;

    if (!response.ok || (providerStatus !== undefined && providerStatus >= 400)) {
      throw new VidaraApiError(
        `Vidara API error (${providerStatus ?? response.status}): ${providerMsg ?? "Request rejected"}`,
        { httpStatus: response.status, providerStatus, providerMessage: providerMsg },
      );
    }

    return unwrapVidaraEnvelope<T>(rawJson);
  }

  const adapter: ProviderAdapter = {
    meta: {
      key: "vidara",
      displayName: "Vidara",
      serviceType: "video_host",
      authType: "api_key",
      credentialSchemaVersion: 1,
      credentialFields: [
        {
          name: "apiKey",
          label: "Vidara API key",
          type: "secret",
          required: true,
          placeholder: "Paste your Vidara API key",
          helpText:
            "Encrypted at rest using AES-GCM. Never returned to the browser or logged in query strings.",
        },
      ],
      capabilities: VIDARA_CAPABILITIES,
      pinnedApiHost: VIDARA_API_BASE_URL,
    },

    async testConnection(credentials: ProviderCredentials): Promise<ProviderAccountInfo> {
      return this.getAccountInfo(credentials);
    },

    async getAccountInfo(credentials: ProviderCredentials): Promise<ProviderAccountInfo> {
      const result = await callVidara<{
        username?: string;
        email?: string;
        premium?: string;
        premium_expire?: string;
        storage_left?: string | number;
        storage_used?: number | string;
        videos_total?: number | string;
      }>(credentials, "/user/info");

      const storageUsed = parseOptionalNumber(result?.storage_used);
      const storageLeft = parseOptionalNumber(result?.storage_left);
      const videosTotal = parseOptionalNumber(result?.videos_total);

      return {
        accountLabel: result?.username || result?.email || "Vidara Account",
        plan: result?.premium && result.premium !== "expired" ? `Premium (${result.premium})` : "Standard",
        storageUsedBytes: storageUsed,
        storageLimitBytes:
          storageUsed !== undefined && storageLeft !== undefined
            ? storageUsed + storageLeft
            : undefined,
        videoCount: videosTotal,
        healthy: true,
        checkedAt: new Date().toISOString(),
      };
    },

    async listAssets(
      credentials: ProviderCredentials,
      query?: ListAssetsQuery,
    ): Promise<ListAssetsResult> {
      const limit = Math.min(query?.limit ?? 100, VIDARA_CAPABILITIES.pagination.maxPageSize);
      const page = query?.page ?? 1;
      const vidaraStatus =
        query?.status === "active" || query?.status === "blocked" || query?.status === "error"
          ? query.status
          : undefined;

      const result = await callVidara<{
        videos?: Array<Record<string, unknown>>;
        page?: number;
        total_pages?: number;
        total?: number;
      }>(credentials, "/video/list", {
        page,
        limit,
        title: query?.title,
        fld_id: query?.folderExternalId,
        status: vidaraStatus,
      });

      const items: NormalizedProviderAsset[] = (result?.videos ?? []).map((v) => ({
        externalId: String(v.filecode ?? ""),
        title: String(v.title ?? "Untitled"),
        canonicalStatus: mapVidaraStatus(typeof v.status === "string" ? v.status : undefined),
        externalUrl: typeof v.link === "string" ? v.link : undefined,
        thumbnailUrl: typeof v.thumbnail === "string" ? v.thumbnail : undefined,
        durationSeconds: parseOptionalNumber(v.length),
        createdAt: typeof v.uploaded === "string" ? v.uploaded : undefined,
        metadataSchemaVersion: 1,
        providerMetadata: {
          vid_id: v.vid_id,
          views: v.views,
          file_active: v.file_active,
        },
      }));

      const currentPage = parseOptionalNumber(result?.page) ?? page;
      const totalPages = parseOptionalNumber(result?.total_pages) ?? currentPage;

      return {
        items,
        nextPage: currentPage < totalPages ? currentPage + 1 : undefined,
        totalCount: parseOptionalNumber(result?.total) ?? items.length,
      };
    },

    async getAsset(
      credentials: ProviderCredentials,
      externalId: string,
    ): Promise<NormalizedProviderAsset | null> {
      const result = await callVidara<Array<Record<string, unknown>> | Record<string, unknown>>(
        credentials,
        "/video/info",
        { filecode: externalId },
      );

      const entry = Array.isArray(result) ? result[0] : result;
      if (!entry || !entry.filecode) return null;

      return {
        externalId: String(entry.filecode),
        title: String(entry.video_title ?? entry.title ?? "Untitled"),
        canonicalStatus: mapVidaraStatus(typeof entry.status === "string" ? entry.status : undefined),
        externalUrl: typeof entry.link === "string" ? entry.link : undefined,
        thumbnailUrl: typeof entry.player_img === "string" ? entry.player_img : undefined,
        durationSeconds: parseOptionalNumber(entry.video_length),
        createdAt: typeof entry.video_created === "string" ? entry.video_created : undefined,
        metadataSchemaVersion: 1,
        providerMetadata: {
          views: entry.video_views,
          file_active: entry.file_active,
        },
      };
    },

    async getProcessingStatus(
      credentials: ProviderCredentials,
      externalId: string,
    ): Promise<ProcessingStatusResult> {
      const result = await callVidara<{
        encodings?: Array<{ filecode?: string; progress_percentage?: string | number }> | null;
      }>(credentials, "/video/status", { filecode: externalId });

      const active = result?.encodings?.find((e) => e.filecode === externalId) ?? result?.encodings?.[0];
      if (!active) {
        return {
          externalId,
          progressPercent: 100,
          completed: true,
          canonicalStatus: "active",
        };
      }

      const progress = Math.min(100, Math.max(0, parseOptionalNumber(active.progress_percentage) ?? 0));
      return {
        externalId,
        progressPercent: progress,
        completed: progress >= 100,
        canonicalStatus: progress >= 100 ? "active" : "processing",
      };
    },

    async listRemoved(
      credentials: ProviderCredentials,
      limit = 50,
    ): Promise<NormalizedProviderAsset[]> {
      const result = await callVidara<{
        files?: Array<{ filecode?: string; title?: string; deleted?: string }>;
      }>(credentials, "/video/deleted", { limit: Math.min(limit, 500) });

      return (result?.files ?? []).map((f) => ({
        externalId: String(f.filecode ?? ""),
        title: String(f.title ?? "Removed video"),
        canonicalStatus: "removed_remote",
        updatedAt: f.deleted,
        metadataSchemaVersion: 1,
        providerMetadata: { deletedAt: f.deleted },
      }));
    },

    async listFlagged(credentials: ProviderCredentials): Promise<NormalizedProviderAsset[]> {
      const result = await callVidara<{
        files?: Array<{ filecode?: string; title?: string; date?: string }>;
      }>(credentials, "/video/dmca");

      return (result?.files ?? []).map((f) => ({
        externalId: String(f.filecode ?? ""),
        title: String(f.title ?? "DMCA flagged video"),
        canonicalStatus: "dmca",
        updatedAt: f.date,
        metadataSchemaVersion: 1,
        providerMetadata: { dmcaDate: f.date },
      }));
    },

    async uploadFromUrl(
      credentials: ProviderCredentials,
      url: string,
      options?: { title?: string; folderExternalId?: string },
    ): Promise<UploadResult> {
      const result = await callVidara<{
        filecode?: string;
        title?: string;
        size?: number | string;
      }>(credentials, "/upload/url", { url });

      const externalId = String(result?.filecode ?? "");
      let assignedFolderId: string | null = null;
      if (externalId && options?.folderExternalId) {
        try {
          await callVidara(credentials, "/video/move", {
            filecode: externalId,
            fld_id: options.folderExternalId,
          });
          assignedFolderId = options.folderExternalId;
        } catch {
          // Non-fatal: upload already succeeded; folder assignment can be retried on Asset Detail
        }
      }

      return {
        externalId,
        title: options?.title ?? String(result?.title ?? "Untitled"),
        sizeBytes: parseOptionalNumber(result?.size),
        canonicalStatus: "processing",
        providerMetadata: {
          ...result,
          ...(assignedFolderId ? { folderId: assignedFolderId } : {}),
        },
      };
    },

    async cloneAsset(credentials: ProviderCredentials, externalId: string): Promise<UploadResult> {
      const result = await callVidara<{ filecode?: string; url?: string }>(
        credentials,
        "/video/clone",
        { filecode: externalId },
      );

      return {
        externalId: String(result?.filecode ?? ""),
        title: `Clone of ${externalId}`,
        canonicalStatus: "active",
        providerMetadata: { sourceFilecode: externalId, url: result?.url },
      };
    },

    async renameAsset(credentials: ProviderCredentials, externalId: string, title: string): Promise<void> {
      await callVidara(credentials, "/video/rename", { filecode: externalId, title });
    },

    async moveAsset(
      credentials: ProviderCredentials,
      externalId: string,
      folderExternalId: string | null,
    ): Promise<void> {
      await callVidara(credentials, "/video/move", {
        filecode: externalId,
        fld_id: folderExternalId ?? "0",
      });
    },

    async deleteAsset(credentials: ProviderCredentials, externalId: string): Promise<void> {
      await callVidara(credentials, "/video/delete", { filecode: externalId });
    },

    async setThumbnail(
      credentials: ProviderCredentials,
      externalId: string,
      imageRef: { url?: string },
    ): Promise<void> {
      if (!imageRef.url) {
        throw new VidaraApiError("Vidara accepts thumbnail URLs only (signed GET URL required).", {
          httpStatus: 400,
        });
      }
      await callVidara(credentials, "/upload/thumb", {
        filecode: externalId,
        thumb_url: imageRef.url,
      });
    },

    async addSubtitle(
      credentials: ProviderCredentials,
      externalId: string,
      language: string,
      ref: { url: string; format: "srt" | "vtt" },
    ): Promise<void> {
      await callVidara(credentials, "/upload/sub", {
        filecode: externalId,
        sub_lang: language,
        sub_url: ref.url,
      });
    },

    async listFolders(credentials: ProviderCredentials): Promise<ProviderFolder[]> {
      const result = await callVidara<{
        folders?: Array<{ fld_id?: string | number; name?: string }>;
      }>(credentials, "/folder/list");

      return (result?.folders ?? []).map((f) => ({
        externalId: String(f.fld_id ?? ""),
        name: String(f.name ?? "Unnamed folder"),
        parentExternalId: null,
      }));
    },

    async createFolder(credentials: ProviderCredentials, name: string): Promise<ProviderFolder> {
      const result = await callVidara<{ folder_id?: string | number; fld_id?: string | number; name?: string }>(
        credentials,
        "/folder/create",
        { name },
      );

      return {
        externalId: String(result?.folder_id ?? result?.fld_id ?? ""),
        name: String(result?.name ?? name),
        parentExternalId: null,
      };
    },

    async renameFolder(credentials: ProviderCredentials, externalId: string, name: string): Promise<void> {
      await callVidara(credentials, "/folder/edit", { fld_id: externalId, name });
    },

    async deleteFolder(credentials: ProviderCredentials, externalId: string): Promise<void> {
      await callVidara(credentials, "/folder/delete", { fld_id: externalId });
    },

    async getStats(credentials: ProviderCredentials, range: { from: string; to: string }): Promise<ProviderStatsPoint[]> {
      const fromMs = Date.parse(range.from);
      const toMs = Date.parse(range.to);
      const days =
        Number.isFinite(fromMs) && Number.isFinite(toMs)
          ? Math.min(365, Math.max(1, Math.ceil((toMs - fromMs) / 86_400_000) + 1))
          : 7;

      const result = await callVidara<{
        stats?: Array<{ day?: string; views?: number | string; earnings?: number | string }>;
      }>(credentials, "/user/stats", { last: days });

      return (result?.stats ?? []).map((s) => ({
        day: String(s.day ?? ""),
        views: parseOptionalNumber(s.views),
        earnings: parseOptionalNumber(s.earnings),
      }));
    },

    async reconcile(
      credentials: ProviderCredentials,
      input: ReconcileInput,
    ): Promise<ReconcileOutcome> {
      const known = new Set(input.knownExternalIds ?? []);
      const listed = await this.listAssets(credentials, {
        page: 1,
        limit: 50,
        title: input.expectedTitle,
      });

      const candidates = listed.items.filter((item) => !known.has(item.externalId));
      if (candidates.length === 1) {
        return {
          resolved: true,
          externalId: candidates[0]!.externalId,
          reason: "Reconciled single unambiguous new asset by diff against Vidara file list.",
        };
      }

      if (candidates.length === 0) {
        return {
          resolved: false,
          reason: "No new matching asset found on Vidara; safe to verify or retry after owner confirmation.",
        };
      }

      return {
        resolved: false,
        reason: `Found ${candidates.length} ambiguous candidate assets on Vidara; manual owner confirmation required.`,
      };
    },

    normalizeError(raw: unknown): CanonicalError {
      const httpStatus = raw instanceof VidaraApiError ? raw.httpStatus : undefined;
      const providerStatus = raw instanceof VidaraApiError ? raw.providerStatus : undefined;
      const status = providerStatus ?? httpStatus;
      const safeMessage =
        raw instanceof Error ? redactUrl(raw.message) : redactUrl(String(raw ?? "Unknown error"));

      if (/timeout|etimedout|abort/i.test(safeMessage)) {
        return {
          code: "TIMEOUT_UNKNOWN",
          retryable: false,
          message: "Vidara request timed out. Reconcile before retrying to avoid duplicate external actions.",
        };
      }
      const providerMessage = raw instanceof VidaraApiError ? raw.providerMessage : undefined;
      if (status === 401 || /invalid.?api.?key|invalid.?key|missing.?api.?key|unauth/i.test(safeMessage)) {
        return {
          code: "AUTH_FAILED",
          retryable: false,
          message: `Vidara rejected the API key (${status ?? "401"}${providerMessage ? `: ${providerMessage}` : ""}). Verify you copied the active key from your Vidara account API settings.`,
          providerCode: status ? String(status) : "401",
        };
      }
      if (status === 403 || /forbidden/i.test(safeMessage)) {
        return {
          code: "AUTH_FAILED",
          retryable: false,
          message: `Vidara returned HTTP 403 (${providerMessage || "Forbidden"}). Check key permissions or upstream Cloudflare protection.`,
          providerCode: "403",
        };
      }
      if (status === 429 || /rate.?limit|too many/i.test(safeMessage)) {
        return {
          code: "RATE_LIMITED",
          retryable: true,
          message: "Vidara rate limit reached. Operation will back off before retrying.",
          providerCode: status ? String(status) : undefined,
        };
      }
      if (status === 404 || /not.?found/i.test(safeMessage)) {
        return {
          code: "NOT_FOUND",
          retryable: false,
          message: "Requested asset or folder was not found on Vidara.",
          providerCode: status ? String(status) : undefined,
        };
      }
      if (status === 400 || /invalid|missing/i.test(safeMessage)) {
        return {
          code: "INVALID_INPUT",
          retryable: false,
          message: "Vidara rejected the request parameters.",
          providerCode: status ? String(status) : undefined,
        };
      }
      if (status !== undefined && status >= 500) {
        return {
          code: "PROVIDER_UNAVAILABLE",
          retryable: true,
          message: "Vidara service is temporarily unavailable.",
          providerCode: String(status),
        };
      }
      return {
        code: "UNKNOWN_PROVIDER_ERROR",
        retryable: false,
        message: "Vidara returned an unrecognized error.",
        providerCode: status ? String(status) : undefined,
      };
    },
  };

  return adapter;
}

export const vidaraProviderAdapter: ProviderAdapter = createVidaraAdapter();
