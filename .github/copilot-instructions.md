<!-- Auto-generated guidance for AI coding agents working in this repository -->
# Copilot / AI Agent Instructions

This repository is a Next.js (App Router) TypeScript service that coordinates video generation jobs, worker processes, and billing/quotas. Use the notes below to be immediately productive.

Key places to read first
- `app/` — Next.js app routes and server handlers (API endpoints live here). Example: `app/api/jobs/video-generation/route.ts` shows the canonical request flow.
- `lib/` — Shared services and helpers (auth, billing, prisma client, observability, rate limiting). Many endpoints call into `lib/*` (e.g., `getSessionUserId`, `requireProjectOwner`, `reserveQuota`).
- `prisma/` — Prisma schema and migrations. Database models (jobs, storyboard, scenes) are defined here.
- `workers/` and `workers.ts` — Background job runners; follow existing patterns for job payloads and idempotency keys.
- `scripts/` — Useful dev and CI helpers (e.g., deterministic e2e, freeze checks, bootstrapping).

Developer workflows & commands
- Start the dev server: `npm run dev` (Next.js app). Many scripts use `tsx` for TypeScript CLI scripts.
- Run background workers: `npm run worker` or run once with `npm run worker:once`.
- Run Prisma tasks: `npm run prisma:generate` and `npm run prisma:migrate`.
- Deterministic e2e: `npm run e2e:deterministic` (sets `SECURITY_SWEEP=1` for deterministic behavior).

Project-specific conventions
- Environment flags: `SECURITY_SWEEP` toggles deterministic, non-destructive modes across scripts and endpoints; respect this when adding tests or behavior toggles.
- Billing & quota: Use `assertMinPlan`, `reserveQuota`, `rollbackQuota` patterns in `lib/billing/*`. Always rollback reservations on early returns or errors.
- Idempotency: Jobs use an `idempotencyKey` JSON string composed from `projectId`, job-type, `storyboardId`, and `scriptId`. New job creation must guard for unique-constraint races and reuse existing jobs when appropriate.
- Request tracing: Many handlers call `getRequestId(req)` and include `requestId` in error responses — preserve this for debuggability.
- Prisma selects: Scenes may store frame urls in `rawJson` rather than as top-level columns. Inspect `app/api/jobs/*` handlers for examples of extracting `firstFrameUrl`/`lastFrameUrl` from `rawJson`.

Patterns to follow in code changes
- Fail fast and rollback: If you reserve quota or modify external state, ensure a best-effort rollback block exists in `catch`/`finally` paths.
- Small, focused changes: The codebase favors surgical changes consistent with existing APIs; avoid large refactors without tests and migration plans.
- Use existing utilities in `lib/` for authentication, observability, and errors instead of reimplementing them.

Integration points & external deps
- Datastore: Prisma (see `prisma/schema.prisma`).
- Workers/Queue: `bull` + Redis patterns; worker code is in `workers/` and `workers/jobRunner.ts`.
- 3rd-party: Stripe, AWS S3, Anthropic SDK — config and usage appear in `lib/stripe.ts`, `lib/mediaStorage.ts`, and provider-specific modules under `lib/imageProviders/`.

If you need more context
- Read `docs/ARCHITECTURE.md` and `docs/SECURITY_OVERVIEW.md` for design intent and constraints.
- Check `package.json` scripts for common developer commands (build, test, worker, e2e flow).

After applying a change
- Run the relevant script: `npm run dev` for endpoints, `npm run worker` for background work, and `npm run e2e:deterministic` for golden comparisons when appropriate.

Questions for maintainers (ask before major changes)
- Are there backward compatibility constraints on job payload shapes or `rawJson` scene formats?
- Any preferred commit message format or branch naming beyond the repository default?

If anything here is unclear or missing for your task, ask and I will refine these instructions.
