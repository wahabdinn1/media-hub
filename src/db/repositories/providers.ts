import { eq } from "drizzle-orm";
import type { ProviderAccountInfo, ProviderAdapter } from "@/core";
import { decryptCredentials, encryptCredentials } from "@/core";
import type { MediaHubDb } from "../client";
import { providerCapabilities, providerConnections } from "../schema";

export interface SanitizedProviderConnection {
  id: string;
  serviceType: string;
  providerKey: string;
  status: string;
  isDefault: boolean;
  authType: string;
  credentialSchemaVersion: number;
  keyVersion: number;
  lastTestedAt: string | null;
  createdAt: string;
  updatedAt: string;
  accountInfo: ProviderAccountInfo | null;
}

function parseAccountMetadata(metadataJson: string): ProviderAccountInfo | null {
  try {
    const parsed = JSON.parse(metadataJson) as { accountInfo?: ProviderAccountInfo };
    return parsed.accountInfo ?? null;
  } catch {
    return null;
  }
}

function toSanitized(
  row: typeof providerConnections.$inferSelect,
): SanitizedProviderConnection {
  return {
    id: row.id,
    serviceType: row.serviceType,
    providerKey: row.providerKey,
    status: row.status,
    isDefault: row.isDefault,
    authType: row.authType,
    credentialSchemaVersion: row.credentialSchemaVersion,
    keyVersion: row.keyVersion,
    lastTestedAt: row.lastTestedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    accountInfo: parseAccountMetadata(row.metadataJson),
  };
}

export async function listSanitizedConnections(
  db: MediaHubDb,
): Promise<SanitizedProviderConnection[]> {
  const rows = await db.select().from(providerConnections);
  return rows.map(toSanitized);
}

export async function getConnectionById(
  db: MediaHubDb,
  id: string,
): Promise<typeof providerConnections.$inferSelect | null> {
  const rows = await db
    .select()
    .from(providerConnections)
    .where(eq(providerConnections.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function createOrUpdateProviderConnection(
  db: MediaHubDb,
  params: {
    adapter: ProviderAdapter;
    credentials: Record<string, string>;
    setAsDefault: boolean;
    accountInfo: ProviderAccountInfo | null;
    status: "active" | "error";
  },
): Promise<SanitizedProviderConnection> {
  const now = new Date().toISOString();
  const { ciphertext, keyVersion } = await encryptCredentials(params.credentials);

  const existing = await db
    .select()
    .from(providerConnections)
    .where(eq(providerConnections.providerKey, params.adapter.meta.key))
    .limit(1);

  if (params.setAsDefault) {
    await db
      .update(providerConnections)
      .set({ isDefault: false, updatedAt: now })
      .where(eq(providerConnections.serviceType, params.adapter.meta.serviceType));
  }

  const metadataJson = JSON.stringify({
    accountInfo: params.accountInfo,
  });

  if (existing[0]) {
    const id = existing[0].id;
    await db
      .update(providerConnections)
      .set({
        status: params.status,
        isDefault: params.setAsDefault ? true : existing[0].isDefault,
        encryptedCredentials: ciphertext,
        credentialSchemaVersion: params.adapter.meta.credentialSchemaVersion,
        keyVersion,
        metadataJson,
        lastTestedAt: params.accountInfo ? now : existing[0].lastTestedAt,
        updatedAt: now,
      })
      .where(eq(providerConnections.id, id));

    await db
      .insert(providerCapabilities)
      .values({
        connectionId: id,
        descriptorJson: JSON.stringify(params.adapter.meta.capabilities),
        descriptorVersion: params.adapter.meta.capabilities.version,
      })
      .onConflictDoUpdate({
        target: providerCapabilities.connectionId,
        set: {
          descriptorJson: JSON.stringify(params.adapter.meta.capabilities),
          descriptorVersion: params.adapter.meta.capabilities.version,
        },
      });

    const updated = await getConnectionById(db, id);
    return toSanitized(updated!);
  }

  const id = crypto.randomUUID();
  const allForService = await db
    .select()
    .from(providerConnections)
    .where(eq(providerConnections.serviceType, params.adapter.meta.serviceType));
  const shouldBeDefault = params.setAsDefault || allForService.length === 0;

  await db.insert(providerConnections).values({
    id,
    serviceType: params.adapter.meta.serviceType,
    providerKey: params.adapter.meta.key,
    status: params.status,
    isDefault: shouldBeDefault,
    authType: params.adapter.meta.authType,
    encryptedCredentials: ciphertext,
    credentialSchemaVersion: params.adapter.meta.credentialSchemaVersion,
    keyVersion,
    metadataJson,
    lastTestedAt: params.accountInfo ? now : null,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(providerCapabilities).values({
    connectionId: id,
    descriptorJson: JSON.stringify(params.adapter.meta.capabilities),
    descriptorVersion: params.adapter.meta.capabilities.version,
  });

  const created = await getConnectionById(db, id);
  return toSanitized(created!);
}

export async function decryptConnectionCredentials(
  row: typeof providerConnections.$inferSelect,
): Promise<Record<string, string>> {
  return decryptCredentials(row.encryptedCredentials);
}

export async function updateConnectionTestResult(
  db: MediaHubDb,
  id: string,
  result: { status: "active" | "error"; accountInfo?: ProviderAccountInfo | null; errorCode?: string },
): Promise<SanitizedProviderConnection> {
  const now = new Date().toISOString();
  const existing = await getConnectionById(db, id);
  if (!existing) {
    throw new Error("Provider connection not found.");
  }

  const prevAccount = parseAccountMetadata(existing.metadataJson);
  const metadataJson = JSON.stringify({
    accountInfo: result.accountInfo !== undefined ? result.accountInfo : prevAccount,
    lastErrorCode: result.errorCode ?? null,
  });

  await db
    .update(providerConnections)
    .set({
      status: result.status,
      metadataJson,
      lastTestedAt: now,
      updatedAt: now,
    })
    .where(eq(providerConnections.id, id));

  const updated = await getConnectionById(db, id);
  return toSanitized(updated!);
}

export async function rotateConnectionCredentials(
  db: MediaHubDb,
  id: string,
  credentials: Record<string, string>,
): Promise<SanitizedProviderConnection> {
  const now = new Date().toISOString();
  const existing = await getConnectionById(db, id);
  if (!existing) {
    throw new Error("Provider connection not found.");
  }
  const { ciphertext, keyVersion } = await encryptCredentials(credentials, {
    keyVersion: existing.keyVersion + 1,
  });

  await db
    .update(providerConnections)
    .set({
      encryptedCredentials: ciphertext,
      keyVersion,
      updatedAt: now,
    })
    .where(eq(providerConnections.id, id));

  const updated = await getConnectionById(db, id);
  return toSanitized(updated!);
}

export async function deleteProviderConnection(db: MediaHubDb, id: string): Promise<void> {
  await db.delete(providerConnections).where(eq(providerConnections.id, id));
}
