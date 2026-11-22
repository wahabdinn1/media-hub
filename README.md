# MediaHub

Personal, single-owner, provider-neutral media management workspace built on Next.js App Router and designed for zero-cost hosting on Cloudflare Workers Free (D1, R2, Queues, Cron, Access).

## Architecture (Modular Monolith)

```
src/
├── shared/        # Canonical statuses, capability descriptor v2, free-tier budgets, redaction, routes, English message catalog
├── core/          # ProviderAdapter v2 contract, ProviderRegistry, connection router, conformance runner, permissions, quota guardrails
├── adapters/
│   ├── vidara/    # Vidara static descriptor, pinned host (api.vidara.so/v1), envelope/status/error normalizers
│   └── mock/      # Mock second provider adapter proving provider neutrality in CI
├── db/            # Drizzle ORM schema for Cloudflare D1 (PRD Section 11)
├── store/         # Zustand ephemeral UI preferences only
├── lib/           # Utilities, server ProviderRegistry, visibility-aware polling hook
├── components/    # AppShell (7-page sidebar, topbar, mobile bottom nav), reusable UI primitives
└── app/           # Next.js App Router pages (Appendix A) and Phase 0 POC API routes
```

## Scripts

```bash
pnpm dev          # Start Next.js dev server
pnpm build        # Production build
pnpm typecheck    # TypeScript strict check
pnpm test         # Run Vitest unit & adapter conformance suite
pnpm lint         # ESLint check
pnpm db:generate  # Generate Drizzle D1 SQL migrations
pnpm cf:build     # Build OpenNext Cloudflare Worker bundle (Phase 0 POC)
```

## Roadmap

See `docs/plans/2026-11-22-mediahub-roadmap.md` for the full Phase 0–7 delivery plan mapped to PRD v1.1 requirement IDs and test cases (`TC-01`–`TC-22`).
