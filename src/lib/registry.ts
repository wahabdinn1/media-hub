import { ProviderRegistry } from "@/core";
import { vidaraProviderAdapter } from "@/adapters/vidara";

/**
 * Runtime provider registry for MediaHub v1.
 * Only ships real production adapters (Vidara). The mock adapter stays isolated in tests.
 */
const registry = new ProviderRegistry();
registry.register(vidaraProviderAdapter);

export function getProviderRegistry(): ProviderRegistry {
  return registry;
}
