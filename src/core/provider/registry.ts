import { CapabilityDescriptorSchema, type ServiceType } from "@/shared";
import type { ProviderAdapter, ProviderAdapterMeta } from "./contract";

export interface ProviderConnectionRecord {
  id: string;
  serviceType: ServiceType;
  providerKey: string;
  status: "active" | "disabled" | "error";
  isDefault: boolean;
}

export type ConnectionRoutingResult =
  | {
      allowed: true;
      mode: "read_write" | "read_only";
      connection: ProviderConnectionRecord;
      reason?: string;
    }
  | {
      allowed: false;
      reason: string;
    };

export class ProviderRegistry {
  private readonly adapters = new Map<string, ProviderAdapter>();

  register(adapter: ProviderAdapter): void {
    CapabilityDescriptorSchema.parse(adapter.meta.capabilities);
    if (this.adapters.has(adapter.meta.key)) {
      throw new Error(`Provider adapter "${adapter.meta.key}" is already registered.`);
    }
    this.adapters.set(adapter.meta.key, adapter);
  }

  get(key: string): ProviderAdapter | undefined {
    return this.adapters.get(key);
  }

  require(key: string): ProviderAdapter {
    const adapter = this.adapters.get(key);
    if (!adapter) {
      throw new Error(`Provider adapter "${key}" is not registered.`);
    }
    return adapter;
  }

  listMeta(serviceType?: ServiceType): ProviderAdapterMeta[] {
    const all = Array.from(this.adapters.values()).map((a) => a.meta);
    return serviceType ? all.filter((m) => m.serviceType === serviceType) : all;
  }
}

export function resolveConnectionForOperation(params: {
  connections: readonly ProviderConnectionRecord[];
  serviceType: ServiceType;
  locationConnectionId?: string;
  mutation: boolean;
}): ConnectionRoutingResult {
  if (params.locationConnectionId) {
    const owned = params.connections.find((c) => c.id === params.locationConnectionId);
    if (!owned) {
      return {
        allowed: false,
        reason: "The connection owning this asset location no longer exists.",
      };
    }

    if (owned.status !== "active") {
      if (params.mutation) {
        return {
          allowed: false,
          reason: `Connection "${owned.providerKey}" is ${owned.status}. Existing locations are read-only.`,
        };
      }
      return {
        allowed: true,
        mode: "read_only",
        connection: owned,
        reason: `Connection "${owned.providerKey}" is ${owned.status}.`,
      };
    }

    if (!owned.isDefault) {
      if (params.mutation) {
        return {
          allowed: false,
          reason: `Connection "${owned.providerKey}" is not the active default connection. Existing locations are read-only.`,
        };
      }
      return {
        allowed: true,
        mode: "read_only",
        connection: owned,
        reason: `Connection "${owned.providerKey}" is non-default (read-only).`,
      };
    }

    return {
      allowed: true,
      mode: "read_write",
      connection: owned,
    };
  }

  const defaults = params.connections.filter(
    (c) => c.serviceType === params.serviceType && c.isDefault && c.status === "active",
  );
  if (defaults.length === 0) {
    return {
      allowed: false,
      reason: `No active default provider connection configured for service "${params.serviceType}".`,
    };
  }
  if (defaults.length > 1) {
    return {
      allowed: false,
      reason: `Invariant violation: multiple default connections found for "${params.serviceType}".`,
    };
  }

  return {
    allowed: true,
    mode: "read_write",
    connection: defaults[0]!,
  };
}
