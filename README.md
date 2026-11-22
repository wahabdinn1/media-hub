# MediaHub

MediaHub is a personal, single-owner, provider-neutral media management workspace built with Next.js App Router, TypeScript, Tailwind CSS v4, and Drizzle ORM on Cloudflare D1. It is engineered to run at \$0/month using a hybrid Vercel Hobby + Cloudflare Free deployment (or directly on Cloudflare Workers Free via OpenNext).

## Features

MediaHub exposes seven top-level pages with no public login screen and no command palette:

- **Dashboard (`/dashboard`):** Catalog metrics, active provider health, recent jobs, alerts (DMCA flags, unclear job outcomes, auth failures), free-tier quota meters, and a lazy-loaded **Analytics** tab (Recharts job success rates, median/p95 durations, daily outcome bars, and capability-gated provider stats).
- **Library (`/library`, `/library/[assetId]`):** Server-paginated table and grid views with title search, status filters, **MediaHub Collections** (create, filter, bulk-add selected assets), and **Provider Folders** (sync, create, delete without deleting videos). Asset Detail provides 5 tabs:
  - *Overview:* Universal metadata and capability-gated provider operations (rename, move folder, clone, collection membership, local soft-delete, and explicit non-restorable remote delete confirmation).
  - *Provider:* External identifiers, sync state, and raw provider metadata.
  - *Thumbnail:* Apply custom thumbnails via authorized direct HTTPS image URLs (JPG/PNG/GIF/WebP, max 5 MiB) while keeping native thumbnails as a restorable fallback.
  - *Subtitles:* Attach direct HTTPS `.srt` or `.vtt` subtitle tracks by language as tracked jobs.
  - *History:* Related jobs and redacted audit events.
- **Import (`/import`, `/import/batches/[batchId]`):** Direct URL import with SSRF-hardened validation, HTML-vs-media classification, rights confirmation logging, and idempotent job tracking; plus bulk paste/CSV import with TanStack Virtual preview, dry-run validation, batch progress detail, retry of eligible failures, and CSV result export.
- **Jobs (`/jobs`, `/jobs/[jobId]`):** Paginated job list, status/type filters, manual encoding status polling (`provider_processing` -> `completed` at 100%), ambiguous-outcome reconciliation ("Check at provider"), redacted event timeline, and an **Activity** audit log tab.
- **Automation (`/automation`, `/automation/[workflowId]`):** Sequential workflow builder (structured step list for `sync_provider`, `import_url`, and `add_recent_to_collection`), manual runs, hourly/daily scheduling on the shared cron tick, and per-step run history.
- **Providers (`/providers`):** Capability-driven provider configuration. Credentials are encrypted with Web Crypto AES-GCM (`mh_v1`) using a versioned master key, verified before saving, rotatable, and never returned to the browser. Ships with the live **Vidara** adapter (`api.vidara.so/v1`) and a test-only **Mock** adapter proving provider neutrality in CI.
- **Settings (`/settings`):** Persistent module toggles (`library`, `import`, `jobs`, `thumbnails`, `automation`, `analytics`), manual kill-switch, dark/light theme switcher, live quota usage meters, and **Secret-Free Metadata Backup Export & Dry-Run Restore**.

## Architecture

Modular monolith inside a single Next.js 16 App Router workspace:

```text
src/
├── shared/          # Canonical statuses, CapabilityDescriptor v2, quota limits, URL/secret redaction, routes, English catalog
├── core/            # ProviderAdapter v2 contract, ProviderRegistry, connection router, crypto, auth, validators, analytics, workflows, backup schema, security audit tests
├── adapters/
│   ├── vidara/      # Live Vidara adapter pinned to https://api.vidara.so/v1 + fixture conformance tests
│   └── mock/        # Test-only second provider adapter for CI conformance (not registered in runtime UI)
├── db/              # Drizzle ORM schema (18 D1 tables), 3-tier D1 client (native binding / Worker gateway HTTP / local node:sqlite), repositories, backup restore drill tests
├── store/           # Zustand ephemeral UI state (theme, sidebar, local mirror of module flags)
├── lib/             # Server ProviderRegistry, API error mapper, visibility-aware polling helper
├── components/      # Responsive AppShell (sidebar, topbar, mobile bottom nav), analytics charts, bulk import panel, UI primitives
└── app/             # 7 App Router pages and 32 owner-authenticated API routes
workers/
└── d1-gateway/      # Cloudflare Worker providing native D1 HTTP gateway + 1-minute cron tick (encoding poll & log retention prune)
drizzle/             # Generated SQL migrations (0000–0003)
docs/
├── add-a-provider.md                      # Guide for adding a new ProviderAdapter v2
└── plans/2026-11-22-mediahub-roadmap.md   # Phase 0–7 execution roadmap and status
```

## Hosting Architecture (\$0 Tier)

MediaHub supports two zero-cost deployment topologies:

1. **Hybrid Vercel Hobby + Cloudflare Free (Active Production Setup):**
   - **Frontend & API:** Next.js App Router on Vercel Hobby (`sin1`), protected by Vercel Authentication (`ssoProtection: "all"`) with `MEDIAHUB_AUTH_MODE=vercel-sso`.
   - **Database & Cron:** Cloudflare D1 Free (`mediahub-db`, 18 tables) accessed through the dedicated `workers/d1-gateway/worker.mjs` Cloudflare Worker (`* * * * *` cron trigger polling due encoding jobs with a 40-call/tick cap and pruning `job_events` after 90 days / `activity_logs` after 365 days).
2. **All-in Cloudflare Workers Free (OpenNext):**
   - Configured via `wrangler.jsonc` and `open-next.config.ts` with Cloudflare Access JWT verification (`CF_ACCESS_AUD`, `CF_ACCESS_TEAM_DOMAIN`).

*Note on Cloudflare R2:* Direct URL import, bulk URL import, and direct-URL custom thumbnails work with **zero R2 usage**. Local file upload staging (`UP-06`) and R2-hosted thumbnail file uploads remain optional until R2 is enabled on your Cloudflare account.

## Security & Operational Guardrails

- **Owner-Only Access:** Every route under `src/app/api/**` enforces `requireOwnerRequest` (verified automatically by `src/core/security/audit.test.ts`), plus same-origin CSRF checks on mutating requests.
- **Credential Protection:** Provider secrets are encrypted at rest with AES-GCM (`MEDIAHUB_MASTER_KEY`), redacted from logs and error messages (including query strings such as `?api_key=...`), and stripped from metadata backup exports.
- **SSRF Defense:** Video, thumbnail, and subtitle URL validators allow only HTTP/HTTPS, reject private/loopback/link-local/metadata IPs, inspect redirects manually, and block HTML pages where media files are expected.
- **Quota Protection:** Tracked daily/monthly counters trigger a warning at 70%, automatic degrade mode at 90% (pausing uploads/bulk jobs), and support an immediate manual kill-switch in Settings.
- **Provider Neutrality:** ESLint (`no-restricted-imports`) and CI tests forbid importing `@/adapters/*` inside `src/app/**` (non-API) or `src/components/**`.

## Local Development

### Prerequisites

- Node.js 24+ (for built-in `node:sqlite` local fallback)
- `pnpm` 11+

### Setup

1. Install dependencies:

```bash
pnpm install
```

2. Copy `.env.example` to `.env.local` and set at least `MEDIAHUB_MASTER_KEY` (16+ random characters). Without Cloudflare D1 variables, MediaHub automatically initializes a local SQLite database at `.data/mediahub.db`.

```bash
cp .env.example .env.local
```

3. Start the dev server:

```bash
pnpm dev
```

Open `http://localhost:3000` (redirects to `/dashboard`).

### Environment Variables

See [`.env.example`](.env.example):

| Variable | Purpose |
| --- | --- |
| `MEDIAHUB_MASTER_KEY` | Required. Master key (16+ chars) for Web Crypto AES-GCM credential encryption. |
| `MEDIAHUB_AUTH_MODE` | Set `vercel-sso` on Vercel Hybrid deployments behind Vercel Authentication. |
| `CF_ACCESS_AUD` / `CF_ACCESS_TEAM_DOMAIN` | Required when running behind Cloudflare Access on Workers. |
| `CLOUDFLARE_D1_GATEWAY_URL` / `CLOUDFLARE_D1_GATEWAY_TOKEN` | Hybrid Vercel -> Cloudflare D1 Worker gateway URL and bearer token. |
| `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_DATABASE_ID` / `CLOUDFLARE_D1_TOKEN` | Alternative direct Cloudflare D1 REST API credentials or remote Drizzle migrations. |

## Scripts

```bash
pnpm dev              # Start Next.js dev server
pnpm build            # Production Next.js build
pnpm start            # Run production server locally
pnpm typecheck        # TypeScript strict check (tsc --noEmit)
pnpm lint             # ESLint check
pnpm test             # Run Vitest unit, conformance, security audit, and backup restore tests
pnpm test:watch       # Vitest watch mode
pnpm db:generate      # Generate Drizzle SQL migrations from src/db/schema.ts
pnpm db:migrate:local # Apply migrations to local Wrangler D1
pnpm cf:build         # Build OpenNext Cloudflare Worker bundle
pnpm cf:preview       # Preview OpenNext bundle locally
pnpm cf:deploy        # Deploy OpenNext bundle to Cloudflare Workers
```

## Verification & Extending

Run the full local gate before pushing changes:

```bash
pnpm test && pnpm typecheck && pnpm exec eslint . --max-warnings=0 && pnpm build
```

- **Adding a new video host provider:** Follow [`docs/add-a-provider.md`](docs/add-a-provider.md).
- **Implementation roadmap & PRD mapping:** See [`docs/plans/2026-11-22-mediahub-roadmap.md`](docs/plans/2026-11-22-mediahub-roadmap.md).
