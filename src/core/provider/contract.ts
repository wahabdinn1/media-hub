import type {
  CanonicalAssetStatus,
  CanonicalError,
  CapabilityDescriptor,
  ServiceType,
} from "@/shared";

export type ProviderAuthType = "api_key" | "oauth" | "none";

export interface CredentialFieldDefinition {
  name: string;
  label: string;
  type: "secret" | "text" | "url";
  required: boolean;
  placeholder?: string;
  helpText?: string;
}

export interface ProviderAdapterMeta {
  key: string;
  displayName: string;
  serviceType: ServiceType;
  authType: ProviderAuthType;
  credentialSchemaVersion: number;
  credentialFields: readonly CredentialFieldDefinition[];
  capabilities: CapabilityDescriptor;
  pinnedApiHost?: string;
}

export interface ProviderCredentials {
  [key: string]: string;
}

export interface ProviderAccountInfo {
  accountLabel: string;
  plan?: string;
  storageUsedBytes?: number;
  storageLimitBytes?: number;
  videoCount?: number;
  healthy: boolean;
  checkedAt: string;
}

export interface NormalizedProviderAsset {
  externalId: string;
  title: string;
  canonicalStatus: CanonicalAssetStatus;
  externalUrl?: string;
  thumbnailUrl?: string;
  sizeBytes?: number;
  durationSeconds?: number;
  folderExternalId?: string | null;
  createdAt?: string;
  updatedAt?: string;
  metadataSchemaVersion: number;
  providerMetadata: Record<string, unknown>;
}

export interface ListAssetsQuery {
  page?: number;
  cursor?: string;
  limit?: number;
  title?: string;
  folderExternalId?: string;
  status?: CanonicalAssetStatus;
}

export interface ListAssetsResult {
  items: NormalizedProviderAsset[];
  nextPage?: number;
  nextCursor?: string;
  totalCount?: number;
}

export interface ProcessingStatusResult {
  externalId: string;
  progressPercent: number;
  completed: boolean;
  canonicalStatus: CanonicalAssetStatus;
}

export interface UploadResult {
  externalId: string;
  title: string;
  sizeBytes?: number;
  canonicalStatus: CanonicalAssetStatus;
  providerMetadata: Record<string, unknown>;
}

export interface ProviderFolder {
  externalId: string;
  name: string;
  parentExternalId: string | null;
}

export interface ProviderStatsPoint {
  day: string;
  views?: number;
  earnings?: number;
}

export interface ReconcileInput {
  jobId: string;
  jobType: string;
  expectedTitle?: string;
  knownExternalIds?: string[];
  startedAt: string;
}

export interface ReconcileOutcome {
  resolved: boolean;
  externalId?: string;
  reason: string;
}

export interface ProviderAdapter {
  readonly meta: ProviderAdapterMeta;

  testConnection(credentials: ProviderCredentials): Promise<ProviderAccountInfo>;
  getAccountInfo(credentials: ProviderCredentials): Promise<ProviderAccountInfo>;

  listAssets(
    credentials: ProviderCredentials,
    query?: ListAssetsQuery,
  ): Promise<ListAssetsResult>;
  getAsset(
    credentials: ProviderCredentials,
    externalId: string,
  ): Promise<NormalizedProviderAsset | null>;
  getProcessingStatus?(
    credentials: ProviderCredentials,
    externalId: string,
  ): Promise<ProcessingStatusResult>;
  listRemoved?(
    credentials: ProviderCredentials,
    limit?: number,
  ): Promise<NormalizedProviderAsset[]>;
  listFlagged?(credentials: ProviderCredentials): Promise<NormalizedProviderAsset[]>;

  uploadFromUrl?(
    credentials: ProviderCredentials,
    url: string,
    options?: { title?: string; folderExternalId?: string },
  ): Promise<UploadResult>;
  uploadFile?(
    credentials: ProviderCredentials,
    source: { signedUrl?: string; fileName: string; contentType: string; sizeBytes: number },
    options?: { title?: string; folderExternalId?: string },
  ): Promise<UploadResult>;
  cloneAsset?(credentials: ProviderCredentials, externalId: string): Promise<UploadResult>;
  renameAsset?(credentials: ProviderCredentials, externalId: string, title: string): Promise<void>;
  moveAsset?(
    credentials: ProviderCredentials,
    externalId: string,
    folderExternalId: string | null,
  ): Promise<void>;
  deleteAsset?(credentials: ProviderCredentials, externalId: string): Promise<void>;
  setThumbnail?(
    credentials: ProviderCredentials,
    externalId: string,
    imageRef: { url?: string; contentType?: string },
  ): Promise<void>;
  addSubtitle?(
    credentials: ProviderCredentials,
    externalId: string,
    language: string,
    ref: { url: string; format: "srt" | "vtt" },
  ): Promise<void>;

  listFolders?(credentials: ProviderCredentials): Promise<ProviderFolder[]>;
  createFolder?(
    credentials: ProviderCredentials,
    name: string,
    parentExternalId?: string | null,
  ): Promise<ProviderFolder>;
  renameFolder?(
    credentials: ProviderCredentials,
    externalId: string,
    name: string,
  ): Promise<void>;
  deleteFolder?(credentials: ProviderCredentials, externalId: string): Promise<void>;

  getStats?(
    credentials: ProviderCredentials,
    range: { from: string; to: string },
  ): Promise<ProviderStatsPoint[]>;

  reconcile(
    credentials: ProviderCredentials,
    input: ReconcileInput,
  ): Promise<ReconcileOutcome>;
  normalizeError(raw: unknown): CanonicalError;
}
