import type { CanonicalError, CapabilityDescriptor } from "@/shared";
import type {
  ListAssetsQuery,
  ListAssetsResult,
  NormalizedProviderAsset,
  ProcessingStatusResult,
  ProviderAccountInfo,
  ProviderAdapter,
  ProviderCredentials,
  ProviderFolder,
  ReconcileInput,
  ReconcileOutcome,
  UploadResult,
} from "@/core";

export const MOCK_CAPABILITIES: CapabilityDescriptor = {
  version: "1.0.0",
  idempotency: "lookup",
  reconciliation: "lookup",
  uploadInput: "url",
  thumbnailInput: "url",
  pagination: {
    style: "cursor",
    maxPageSize: 100,
  },
  listFilters: {
    title: true,
    folder: true,
    status: true,
    updatedSince: true,
  },
  folders: "tree",
  deleteSemantics: {
    mode: "soft",
    restorable: true,
  },
  clone: true,
  rename: true,
  asyncProcessing: true,
  removedList: true,
  copyrightFlags: false,
  stats: false,
  subtitles: false,
  rateLimit: {
    requestsPerWindow: 60,
    windowSeconds: 60,
    burst: 10,
  },
  limits: {
    maxFileSizeBytes: 2 * 1024 * 1024 * 1024,
    acceptedMimeTypes: ["video/mp4", "video/webm"],
    maxTitleLength: 200,
  },
};

const FIXTURE_ASSETS: NormalizedProviderAsset[] = [
  {
    externalId: "mock_ext_001",
    title: "Product Demo Cut v1",
    canonicalStatus: "active",
    externalUrl: "https://mock.mediahub.invalid/watch/mock_ext_001",
    sizeBytes: 42_000_000,
    durationSeconds: 184,
    folderExternalId: "mock_folder_root",
    createdAt: "2026-11-20T10:00:00.000Z",
    updatedAt: "2026-11-20T10:05:00.000Z",
    metadataSchemaVersion: 1,
    providerMetadata: { codec: "h264", fixture: true },
  },
  {
    externalId: "mock_ext_002",
    title: "Studio B-Roll Raw",
    canonicalStatus: "processing",
    externalUrl: "https://mock.mediahub.invalid/watch/mock_ext_002",
    sizeBytes: 128_000_000,
    durationSeconds: 410,
    folderExternalId: "mock_folder_root",
    createdAt: "2026-11-21T08:00:00.000Z",
    updatedAt: "2026-11-21T08:02:00.000Z",
    metadataSchemaVersion: 1,
    providerMetadata: { encodingProgress: 42, fixture: true },
  },
];

const FIXTURE_FOLDERS: ProviderFolder[] = [
  { externalId: "mock_folder_root", name: "Archive", parentExternalId: null },
  { externalId: "mock_folder_sub", name: "2026 Cuts", parentExternalId: "mock_folder_root" },
];

export const mockProviderAdapter: ProviderAdapter = {
  meta: {
    key: "mock",
    displayName: "Mock Provider (CI Conformance)",
    serviceType: "video_host",
    authType: "api_key",
    credentialSchemaVersion: 1,
    credentialFields: [
      {
        name: "apiKey",
        label: "Mock API token",
        type: "secret",
        required: true,
        placeholder: "mock_tok_...",
        helpText: "Fixture token used for local development and provider-neutrality CI tests.",
      },
    ],
    capabilities: MOCK_CAPABILITIES,
    pinnedApiHost: "https://mock.mediahub.invalid",
  },

  async testConnection(credentials: ProviderCredentials): Promise<ProviderAccountInfo> {
    if (!credentials.apiKey) {
      throw Object.assign(new Error("Missing mock API key"), { status: 401 });
    }
    return {
      accountLabel: "Mock Sandbox Owner",
      plan: "sandbox",
      storageUsedBytes: 170_000_000,
      storageLimitBytes: 10_000_000_000,
      videoCount: FIXTURE_ASSETS.length,
      healthy: true,
      checkedAt: new Date().toISOString(),
    };
  },

  async getAccountInfo(credentials: ProviderCredentials): Promise<ProviderAccountInfo> {
    return this.testConnection(credentials);
  },

  async listAssets(
    _credentials: ProviderCredentials,
    query?: ListAssetsQuery,
  ): Promise<ListAssetsResult> {
    const filtered = FIXTURE_ASSETS.filter((item) => {
      if (query?.status && item.canonicalStatus !== query.status) return false;
      if (query?.title && !item.title.toLowerCase().includes(query.title.toLowerCase())) {
        return false;
      }
      return true;
    });
    return {
      items: filtered.slice(0, query?.limit ?? 50),
      totalCount: filtered.length,
    };
  },

  async getAsset(
    _credentials: ProviderCredentials,
    externalId: string,
  ): Promise<NormalizedProviderAsset | null> {
    return FIXTURE_ASSETS.find((item) => item.externalId === externalId) ?? null;
  },

  async getProcessingStatus(
    _credentials: ProviderCredentials,
    externalId: string,
  ): Promise<ProcessingStatusResult> {
    if (externalId === "mock_ext_002") {
      return {
        externalId,
        progressPercent: 42,
        completed: false,
        canonicalStatus: "processing",
      };
    }
    return {
      externalId,
      progressPercent: 100,
      completed: true,
      canonicalStatus: "active",
    };
  },

  async listRemoved(): Promise<NormalizedProviderAsset[]> {
    return [
      {
        externalId: "mock_ext_removed",
        title: "Deprecated Teaser",
        canonicalStatus: "removed_remote",
        metadataSchemaVersion: 1,
        providerMetadata: { removedAt: "2026-11-19T12:00:00.000Z" },
      },
    ];
  },

  async uploadFromUrl(
    _credentials: ProviderCredentials,
    _url: string,
    options?: { title?: string },
  ): Promise<UploadResult> {
    return {
      externalId: "mock_ext_uploaded",
      title: options?.title ?? "Untitled Mock Import",
      canonicalStatus: "processing",
      providerMetadata: { accepted: true },
    };
  },

  async listFolders(): Promise<ProviderFolder[]> {
    return FIXTURE_FOLDERS;
  },

  async reconcile(
    _credentials: ProviderCredentials,
    input: ReconcileInput,
  ): Promise<ReconcileOutcome> {
    const match = FIXTURE_ASSETS.find(
      (asset) =>
        input.expectedTitle &&
        asset.title.toLowerCase() === input.expectedTitle.toLowerCase() &&
        !(input.knownExternalIds ?? []).includes(asset.externalId),
    );
    if (match) {
      return {
        resolved: true,
        externalId: match.externalId,
        reason: "Matched single asset via mock lookup.",
      };
    }
    return {
      resolved: false,
      reason: "No unambiguous match found; manual confirmation required.",
    };
  },

  normalizeError(raw: unknown): CanonicalError {
    const message = raw instanceof Error ? raw.message : String(raw);
    if (/timeout|etimedout|abort/i.test(message)) {
      return {
        code: "TIMEOUT_UNKNOWN",
        retryable: false,
        message: "Provider request timed out; outcome unclear until reconciled.",
      };
    }
    if (/401|unauth|missing/i.test(message)) {
      return {
        code: "AUTH_FAILED",
        retryable: false,
        message: "Mock provider authentication failed.",
      };
    }
    return {
      code: "UNKNOWN_PROVIDER_ERROR",
      retryable: false,
      message: "Unexpected mock provider error.",
    };
  },
};
