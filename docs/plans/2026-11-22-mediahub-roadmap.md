# MediaHub — Phased Implementation Plan (PRD v1.1)

**Goal:** Build MediaHub as a single-owner, provider-neutral modular media management web app hosted at zero cost on Cloudflare Workers Free (Next.js App Router + D1 + R2 + Queues + Cron + Access).

**Architecture:** Modular monolith inside a single Next.js App Router root (`src/shared`, `src/core`, `src/adapters/*`, `src/db`, `src/components`, `src/app`). Provider integrations stay strictly behind `ProviderAdapter` v2 and static capability descriptors. Zero hardcoded UI copy; all strings live in `src/shared/i18n/en.ts`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS v4, shadcn/ui + Radix, Lucide React, Motion for React, TanStack Query, TanStack Table, TanStack Virtual (bulk preview & job events only), Recharts (lazy-loaded), React Hook Form + Zod, Zustand, Drizzle ORM (Cloudflare D1), `@opennextjs/cloudflare`, Wrangler, Vitest.

**Spec:** `../MediaHub — Product Requirements Document.md` (v1.1, 22 Nov 2026)

## Global Constraints

- Zero-cost Cloudflare hosting is a hard v1 constraint (no paid plan fallback).
- Tracked quota warning at 70%, automatic degrade mode at 90%, manual kill-switch available.
- R2 hard caps: 3 GiB total staging, 1 GiB per-file staging (until spike proves higher), 24h expiry, 5 MiB per custom thumbnail, 1 GiB total thumbnails, 700k Class A / 7M Class B monthly stops.
- Seven top-level pages only (`/dashboard`, `/library`, `/import`, `/jobs`, `/automation`, `/providers`, `/settings`). No `/login` route, no command palette.
- Every provider secret is encrypted at rest (AES-GCM via Web Crypto, versioned master key in Worker Secret), never returned to the browser, and redacted from all logs including URL query strings.
- Provider-neutral: no UI module imports an adapter directly; adding a second provider requires zero module page changes (continuously proved by `mock` adapter).

---

## Execution Status Summary (Updated 22 Nov 2026)

- **Hosting Architecture:** Hybrid \$0 stack — Next.js App Router on **Vercel Hobby** (`sin1`, Vercel SSO protection) + **Cloudflare D1 Free** (`mediahub-db`, 18 tables) + **Cloudflare Worker Free** (`mediahub-d1-gateway` with native D1 binding and `* * * * *` cron trigger).
- **Phase 0–4:** Completed, verified locally and live in production.
- **Phase 5 (Part 1 — Zero-R2):** Completed (MediaHub Collections, provider rename/move/clone/delete with non-restorable warning, local soft-delete, SSRF-hardened direct image URL custom thumbnails). R2 file staging (`UP-06`) and R2 thumbnail file upload remain optional until Cloudflare R2 is enabled by the owner.
- **Phase 6:** Completed (Sequential Automation Workflows + shared-tick scheduling, lazy-loaded Recharts Dashboard Analytics + Vidara Stats panel, SRT/VTT Subtitle URL attachment).
- **Phase 7:** Completed (API auth & UI isolation invariant tests, SSRF matrix tests, secret-free metadata backup export & dry-run/restore workflow in Settings, and `docs/add-a-provider.md`).

---

## Phase 0 — Foundation, UX Shell, and Workers POC Gate (COMPLETED IN REPO)

**Scope (PRD 12.4, 17):**
- [x] Next.js App Router scaffolded via `pnpm create next-app@latest` with full PRD tech stack installed.
- [x] Semantic dark-graphite default + light theme design tokens (`src/app/globals.css`), reduced-motion support, WCAG AA focus states.
- [x] Responsive 7-page AppShell: collapsible desktop sidebar, topbar (breadcrumbs, plain global search, New dropdown, visibility-aware polling job indicator, theme toggle), mobile bottom nav + More sheet.
- [x] Typed English message catalog (`src/shared/i18n/en.ts`).
- [x] `ProviderAdapter` v2 contract, `ProviderRegistry`, location-bound connection router, shared conformance suite runner (`src/core/provider/*`).
- [x] `mock` second provider adapter passing conformance suite (`TC-16`) + `vidara` verified static descriptor & envelope/error normalizer (`TC-11`).
- [x] Zero-cost quota guardrails (`evaluateQuotaState`, `canEnqueueJob`, `canStageR2File` — `TC-18`, `TC-19`) and URL/secret redaction (`TC-07`).
- [x] Drizzle D1 schema blueprint (`src/db/schema.ts`) and Cloudflare `wrangler.jsonc` + `open-next.config.ts` + POC routes (`/api/poc/health`, `/api/poc/mock-provider`).
- [ ] **Manual/Live POC Gate (PRD 12.4):** Deploy to Cloudflare Workers Free (using Cloudflare plugin/Wrangler), benchmark Scenarios 1–5 (100 reqs each), verify CPU p99 <= 7 ms & bundle size acceptance. Record outcome before Phase 1 backend lock-in.

**Exit Criteria:** Responsive shell builds cleanly, Vitest unit + conformance suite passes, and live Workers Free POC pass/fallback decision is recorded.

---

## Phase 1 — Platform Core, Auth Boundary, and D1 Persistence

**Requirements:** `PROV-01..04`, `PROV-06`, `SYS-01..03`, `SYS-05..06`, `LIB-01`, `TC-06`, `TC-07`, `TC-08`, `TC-20`
**Deliverables:**
- [ ] Cloudflare Access JWT validator middleware (`aud`, `iss`, JWKS signature + expiry verification on every request, including `workers.dev` and preview URLs — `TC-06`, `TC-20`).
- [ ] CSRF protection (Origin/custom header check) on all mutating API routes.
- [ ] Generate and apply initial Drizzle D1 migrations (`drizzle/`) for all Section 11 tables (including partial unique indexes for single default connection and single active thumbnail).
- [ ] Web Crypto AES-GCM credential encryption/decryption service with `key_version` and Worker Secret master key.
- [ ] Persistent `app_settings`, `module_settings`, `provider_connections`, `assets`, `asset_locations`, `usage_counters`, and `activity_logs` repositories.
- [ ] Wire Settings page (module toggles, kill-switch) and Providers page (save/test/rotate/disconnect credentials via generated form) to live D1 APIs.

**Exit Criteria:** Owner-only Access enforcement verified; credentials encrypted in D1 and never echoed; universal asset and connection records persist cleanly.

---

## Phase 2 — Vidara Adapter & Conformance Suite

**Requirements:** `PRD 12.6`, `PROV-02`, `PROV-03`, `PROV-05`, `PROV-07`, `UP-05`, `TC-07`, `TC-11`, `TC-12`
**Deliverables:**
- [ ] Implement live Vidara HTTP client pinned to `https://api.vidara.so/v1` (plus upload server returned by `/upload/server`).
- [ ] Enforce strict redaction of `?key=...` across fetch wrappers, subrequest traces, and error objects (`TC-07`).
- [ ] Implement operations: `testConnection`, `getAccountInfo`, `listAssets` (paged up to 200), `getAsset`, `getProcessingStatus`, `listRemoved`, `listFlagged`, `uploadFromUrl`, `cloneAsset`, `renameAsset`, `moveAsset`, `deleteAsset`, `setThumbnail`, `addSubtitle`, flat folder CRUD, `getStats`.
- [ ] Recorded JSON fixtures (with fake credentials only) covering `result`, `data`, and flat upload envelopes plus error classes (`TC-11`).
- [ ] Diff-based reconciliation (`reconcile`) adopting a single unambiguous match and keeping ambiguous outcomes `unknown` (`TC-12`).
- [ ] Run shared conformance suite against both Vidara fixtures and `mock` adapter in CI (`TC-16`).

**Exit Criteria:** Vidara adapter passes conformance suite and syncs a controlled authorized account without exposing keys.

---

## Phase 3 — Library & Direct URL Import MVP

**Requirements:** `DB-01..04`, `VID-01..03`, `VID-06`, `UP-01..05`, `JOB-01..05`, `JOB-07..08`, `TH-01`, `TC-01`, `TC-02`, `TC-03`, `TC-09`, `TC-14`
**Deliverables:**
- [ ] SSRF-hardened URL validator: HTTP/HTTPS only, block loopback/private/link-local/metadata IPs, manual redirect hop checks, bounded HEAD/Range inspection classifying direct media files vs web pages (`TC-01`, `TC-09`).
- [ ] Direct URL Import flow with one-time-per-session/batch rights confirmation logged to `activity_logs`.
- [ ] Idempotent job creation (`UNIQUE(idempotency_key)` returning existing job on repeat — `TC-03`).
- [ ] Library catalog server-paginated table/grid with search & filters, Asset Detail 5-tab view, write-on-change provider sync (`content_hash`), and encoding progress display (`provider_processing` -> `completed` only at 100% — `TC-14`).
- [ ] Job Center list, filters, redacted Job Detail timeline, and Activity audit tab.

**Exit Criteria:** Authorized direct video URL validates, creates a tracked job, registers universal asset + location, and tracks encoding to 100%.

---

## Phase 4 — Job Engine, Cron Tick, Bulk Import, and Degrade Mode

**Requirements:** `BULK-01..04`, `JOB-03`, `JOB-05`, `JOB-06`, `JOB-09`, `SYS-06`, `TC-04`, `TC-05`, `TC-12`, `TC-18`, `TC-21`
**Deliverables:**
- [ ] Custom OpenNext/Cloudflare Worker entrypoint exporting `fetch`, `queue` (idempotent consumer handling chunks of up to 10 job IDs + DLQ), and `scheduled` (single `* * * * *` cron tick).
- [ ] Cron tick priority loop capped at 40 external subrequests per tick (`TC-21`): re-dispatch stuck `queued` jobs -> poll due `provider_processing` -> re-queue `retry_wait` -> scheduled sync -> prune `job_events` (90d) & `activity_logs` (365d) -> flush `usage_counters`.
- [ ] Ambiguous outcome reconciliation UX ("Outcome unclear" -> "Check at provider") blocking blind retries (`TC-04`).
- [ ] Bulk paste/CSV parser with TanStack Virtual preview table, dry-run summary, atomic batch header + per-item job creation, retry eligible failures, and result CSV export.
- [ ] Enforce live 70% warning / 90% degrade mode banner + upload/bulk block (`TC-18`) and kill-switch.

**Exit Criteria:** Duplicate delivery (`TC-05`), timeout reconciliation (`TC-04`), 100-job cron cap (`TC-21`), and degrade mode (`TC-18`) tests pass.

---

## Phase 5 — Thumbnails, Local Upload Spike, and Library Organization

**Requirements:** `UP-06`, `TH-02..04`, `VID-04..05`, `VID-07..09`, `LIB-02..04`, `TC-10`, `TC-13`, `TC-15`, `TC-19`, `TC-22`
**Deliverables:**
- [ ] **Local file spike (PRD 12.5):** Test 100 MB, 1 GB, and 5 GB R2 presigned PUT + provider pull from short-lived presigned GET URL; enforce R2 caps before signing (`TC-19`).
- [ ] Custom thumbnail upload to R2 (<= 5 MiB, <= 1 GiB total), short-lived signed GET URL application for URL-only providers (`TC-13`), native fallback, and history.
- [ ] Capability-gated provider operations: clone, rename, move, soft-delete confirmation explicitly stating "no restore" for Vidara (`TC-22`), plus Provider Folders UI (`VID-09`).
- [ ] MediaHub Folders & Collections (`LIB-02..03`) using atomic D1 batch updates.
- [ ] Removed (`removed_remote`, never auto-deleted — `TC-15`) and DMCA (`dmca` + Dashboard alert) views.

**Exit Criteria:** Thumbnail and organization flows preserve universal asset identity and respect all R2 caps.

---

## Phase 6 — Automation, Analytics, and Subtitles (P2)

**Requirements:** `AUTO-01..04`, `AN-01..03`, `SUB-01`, `PROV-08`
**Deliverables:**
- [ ] Sequential workflow builder (structured step list, no visual canvas), run history, and shared-tick scheduling.
- [ ] Lazy-loaded Recharts analytics tab on Dashboard (job rates, median/p95 durations) + capability-gated provider stats panel via extension slot (`PROV-08`).
- [ ] Subtitle URL attachment (SRT/VTT + language) as tracked jobs (`SUB-01`).

**Exit Criteria:** Workflow runs, analytics aggregates, and subtitle jobs pass integration checks within free-tier budgets.

---

## Phase 7 — Hardening, Backup Drill, and Provider-Readiness Sign-off

**Requirements:** `SYS-04`, `PRD 16.1`, `PRD 19`
**Deliverables:**
- [ ] Full security audit: secret/log scan, SSRF matrix, Access JWT spoofing, CSRF, and authorization coverage across all routes.
- [ ] Weekly secret-free metadata export to R2 + tested restore drill to an empty D1 database.
- [ ] Desktop & 360 px Android viewport QA + WCAG 2.2 AA accessibility check.
- [ ] Written "Add a Provider" guide verified end-to-end against `mock` adapter (`TC-16`).

**Exit Criteria:** Release acceptance checklist (PRD 16.1) and Definition of Done (PRD 19) 100% checked off.
