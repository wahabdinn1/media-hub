# Adding a New Video Host Provider to MediaHub

MediaHub is provider-neutral by architecture. Adding a second video host provider requires **zero changes** to UI pages (`src/app/**`) or shared UI components (`src/components/**`). Every provider-specific detail stays behind `ProviderAdapter` v2 and its static `CapabilityDescriptor`.

## 1. Create the Adapter Folder

Create `src/adapters/<provider-key>/index.ts` exporting a `ProviderAdapter` instance (see `src/adapters/vidara/index.ts` and `src/adapters/mock/index.ts` for reference).

### Required Metadata (`adapter.meta`)
- `key`: unique lowercase identifier (e.g. `streamtape`, `doodstream`, `bunny`).
- `displayName`: human-readable label rendered in Providers and Asset Detail.
- `serviceType`: `"video_host"`.
- `authType`: `"api_key" | "oauth" | "none"`.
- `credentialFields`: declarative form schema used by `/providers` to render credential inputs automatically without UI code edits.
- `capabilities`: a strict `CapabilityDescriptor` validated by `CapabilityDescriptorSchema` at registration time.

### Capability Gating Rules
- Only implement optional methods whose corresponding capability flag is declared (`uploadFromUrl`, `renameAsset`, `moveAsset`, `cloneAsset`, `deleteAsset`, `setThumbnail`, `addSubtitle`, `listFolders`, `createFolder`, `renameFolder`, `deleteFolder`, `getStats`).
- Set `deleteSemantics: { mode: "soft" | "hard" | "none", restorable: boolean }` accurately; MediaHub's delete confirmation UI automatically warns the owner whenever `restorable: false`.
- Never log or return raw API keys or query strings; pass error messages through `redactUrl` from `@/shared`.

## 2. Implement Error Normalization & Reconciliation
- `normalizeError(raw)` must map provider HTTP/body errors into canonical error codes (`AUTH_FAILED`, `RATE_LIMITED`, `NOT_FOUND`, `INVALID_INPUT`, `UNSUPPORTED`, `CONFLICT`, `QUOTA_EXCEEDED`, `PROVIDER_UNAVAILABLE`, `TIMEOUT_UNKNOWN`, `UNKNOWN_PROVIDER_ERROR`).
- On network/timeout errors during non-idempotent mutations, return `TIMEOUT_UNKNOWN` with `retryable: false` so MediaHub transitions the job to `unknown` instead of blindly retrying.
- Implement `reconcile(credentials, input)` using either `lookup` (by idempotency key) or `diff` (comparing remote catalog against `knownExternalIds`). Adopt only a single unambiguous match.

## 3. Register the Adapter

Register your adapter in `src/lib/registry.ts`:

```ts
import { myProviderAdapter } from "@/adapters/my-provider";

registry.register(myProviderAdapter);
```

Do **not** import `@/adapters/*` anywhere under `src/app/**` (except server API routes via `getProviderRegistry()`) or `src/components/**`. ESLint (`no-restricted-imports`) and `src/core/security/audit.test.ts` enforce this boundary in CI.

## 4. Verify with the Shared Conformance Suite (`TC-16`)

Create `src/adapters/<provider-key>/conformance.test.ts` and invoke `runProviderConformanceSuite` with recorded JSON fixtures (using fake credentials only):

```ts
import { describe } from "vitest";
import { runProviderConformanceSuite } from "@/core";
import { createMyProviderAdapter } from "./index";

describe("my-provider conformance", () => {
  runProviderConformanceSuite({
    adapter: createMyProviderAdapter({ fetchImpl: fixtureFetch }),
    validCredentials: { apiKey: "test-fixture-key" },
    invalidCredentials: { apiKey: "invalid-key" },
  });
});
```

Run the full verification gate before opening a PR:

```bash
pnpm test && pnpm typecheck && pnpm exec eslint . --max-warnings=0 && pnpm build
```
