# Security & Data Architecture

**Status:** Current buyer-grade technical diligence baseline.  
**Scope:** This document describes the current trust boundaries, tenant-isolation model, data lifecycle, deletion/export posture, logging posture, and secret-management posture of the platform as verified from the repository.

This file is intended to be the canonical technical diligence document. If another security doc conflicts with this file, the conflict should be resolved in favor of the most conservative repo-verifiable statement.

---

## 1) Executive summary

Current supportable statement:

> Tenant isolation is currently enforced primarily through authenticated API ownership checks and project-scoped or user-scoped database queries. Database-level RLS should not be represented as the active isolation control unless it is separately validated in the deployed database environment.

Current maturity summary:

- Application-layer auth and ownership enforcement: present and broadly implemented
- Project-scoped read/write protection: present on core API surfaces
- Database-level RLS proof in staging/production: not repo-proven
- Project purge: implemented
- Tenant-wide purge: not implemented
- Partial export capabilities: implemented
- Full project export bundle: not implemented
- Data retention policy: documented as indefinite-until-delete
- Audit/application log retention window: not yet formally enforced

Supporting docs:

- `docs/SECURITY_GAPS.md`
- `docs/SECURITY_OVERVIEW.md`
- `docs/RLS_DISCLOSURE.md`
- `docs/DATA_RETENTION_POLICY.md`
- `docs/SECRET_ROTATION_RUNBOOK.md`

---

## 2) System trust boundaries

### 2.1 App and API boundary

Primary entry points:

- `app/api/**`
- authenticated project-scoped UI pages backed by those routes

Primary auth model:

- NextAuth session-based request handling via `requireSession`
- session user ID resolution via `getSessionUserId`

Primary authorization model:

- project ownership enforced in the application layer
- representative helpers:
  - `lib/requireProjectOwner.ts`
  - `lib/auth/requireProjectOwner404.ts`

Current behavior:

- core project-scoped routes typically require a valid session
- then require that the caller owns the target `projectId`
- then query only records associated with that `projectId`
- some job routes additionally scope by `userId`

Admin/debug path:

- admin-style debug access is gated by `x-debug-admin-token`
- in non-production only, some paths may also accept a `token` query parameter
- implementation lives in `lib/admin/isAdminRequest.ts`

Conservative note:

- any route that bypasses normal ownership checks through an admin/debug path should be treated as privileged operational access, not tenant-safe end-user access

### 2.2 Worker boundary

Primary entry points:

- `workers/jobRunner.ts`
- worker/job service code under `lib/**`

Current model:

- jobs are stored in Postgres
- worker claims jobs through the DB-backed job state model
- worker processes job payloads after the API layer has already associated them to a project/user context

Important limitation:

- the worker is not the primary multitenancy enforcement boundary
- multitenancy is enforced earlier, at authenticated API creation/read/delete points

### 2.3 Database boundary

Primary datastore:

- PostgreSQL via Prisma

Current isolation statement:

- the currently proven control is application-layer ownership enforcement
- repo evidence does not currently prove active deployed RLS enforcement in staging/production

This means:

- buyers should evaluate the system as app-layer enforced multitenancy
- not as independently repo-proven DB-layer multitenancy

### 2.4 External provider boundary

External providers currently referenced by the repo include:

- Anthropic
- AWS S3
- KIE
- Fal
- Apify
- AssemblyAI
- Google Vision
- Stripe
- ElevenLabs
- OpenClaw-related integration secrets

Current expectation:

- provider calls should be treated as data egress boundaries
- secrets must be managed operationally through environment configuration
- provider failures should be sanitized and truncated, but that hardening is not yet complete everywhere

---

## 3) Tenant isolation model

### 3.1 Tenant definition

The effective tenant boundary today is:

- one `userId` owns one or more `projectId`s
- project-scoped artifacts are read and mutated through routes that validate session ownership

### 3.2 Exact current enforcement points

The dominant enforcement pattern today is:

1. resolve authenticated user identity
2. validate project ownership
3. scope reads/writes by `projectId`
4. where applicable, scope direct job lookups by `userId` as well

Core helpers:

- `lib/auth/requireSession.ts`
- `lib/getSessionUserId.ts`
- `lib/requireProjectOwner.ts`
- `lib/auth/requireProjectOwner404.ts`

Representative ownership-protected project/artifact read routes:

- `app/api/projects/[projectId]/jobs/route.ts`
- `app/api/projects/[projectId]/jobs/[jobId]/route.ts`
- `app/api/projects/[projectId]/customer-analysis/[jobId]/route.ts`
- `app/api/projects/[projectId]/pattern-analysis/route.ts`
- `app/api/projects/[projectId]/run-summary/[runId]/route.ts`
- `app/api/projects/[projectId]/runs/[runId]/research-jobs/route.ts`
- `app/api/projects/[projectId]/runs/[runId]/creative-jobs/route.ts`
- `app/api/projects/[projectId]/runs/[runId]/ad-assets/route.ts`
- `app/api/projects/[projectId]/research/route.ts`
- `app/api/projects/[projectId]/research/export/route.ts`
- `app/api/projects/[projectId]/scripts/route.ts`
- `app/api/projects/[projectId]/scripts/[scriptId]/route.ts`
- `app/api/projects/[projectId]/characters/route.ts`
- `app/api/projects/[projectId]/customer-avatar/route.ts`
- `app/api/projects/[projectId]/product-intelligence/route.ts`

Representative ownership-protected job-trigger routes:

- `app/api/jobs/customer-research/route.ts`
- `app/api/jobs/customer-analysis/route.ts`
- `app/api/jobs/ad-collection/route.ts`
- `app/api/jobs/ad-transcripts/route.ts`
- `app/api/jobs/ad-quality-gate/route.ts`
- `app/api/jobs/pattern-analysis/route.ts`
- `app/api/jobs/product-collection/route.ts`
- `app/api/jobs/product-analysis/route.ts`
- `app/api/jobs/script-generation/route.ts`
- `app/api/jobs/storyboard-generation/route.ts`
- `app/api/jobs/video-prompts/route.ts`
- `app/api/jobs/video-images/route.ts`
- `app/api/jobs/video-generation/route.ts`
- `app/api/jobs/video-reviewer/route.ts`
- `app/api/jobs/video-upscaler/route.ts`

### 3.3 No-leak behavior

Current behavior is mixed but generally strong on key sensitive routes:

- some routes use `requireProjectOwner404` to collapse forbidden/missing into `404`
- some routes return `401` for no session and `403` or `404` after that depending on route style

Current supportable statement:

- selective no-leak behavior exists on important routes
- but exhaustive consistency proof across all sensitive endpoints is not yet closed

### 3.4 What is not yet proven

Not currently repo-proven:

- active deployed RLS enforcement in staging/production
- full cross-tenant negative coverage for the top sensitive endpoints
- exhaustive verification of every job-read endpoint’s exact `404/403` behavior

---

## 4) Data classification

### 4.1 Identity and account data

- user IDs
- emails
- auth/session-linked identifiers
- IPs where logged

### 4.2 Customer and client inputs

- project names
- product names and product setup references
- research prompts and strategy inputs
- brand and creative inputs

### 4.3 Collected research data

- Reddit-derived research rows
- Amazon review data
- ad assets and ad metadata
- OCR and transcript outputs
- pattern analysis outputs
- product-intelligence records
- customer-analysis outputs

### 4.4 Generated creative artifacts

- scripts
- storyboards
- storyboard scenes
- image prompts
- generated frames/images
- video prompts
- generated videos
- merged/upscaled outputs
- character/avatar assets

### 4.5 Logs and audit records

- database audit log rows
- app logs
- worker logs
- provider-side logs outside this system

---

## 5) Data lifecycle

### 5.1 Creation

Data originates from three primary sources:

- direct user input through UI/API
- worker-generated artifacts
- external-provider outputs from research, transcription, OCR, LLM, and media-generation services

### 5.2 Storage

Current storage model:

- primary relational metadata is stored in Postgres
- many core artifact tables are associated to a `projectId`
- many records are also associated to a `jobId` and, indirectly, a `runId`
- file-like assets are stored as URLs/references to external object storage or provider outputs

### 5.3 Retention specifics

Current written policy is defined in `docs/DATA_RETENTION_POLICY.md`.

Current exact posture:

- business/project data is generally retained indefinitely until deleted
- generated artifacts are generally retained indefinitely until deleted
- research data is generally retained indefinitely until deleted
- audit log rows and application logs do not yet have a formally enforced retention window

Current buyer-safe statement:

> Customer project data, generated artifacts, and related logs are retained indefinitely until deleted through platform delete actions, infrastructure cleanup, or manual administrative intervention.

Important qualification:

- this is a practical current-state disclosure, not a fully automated retention program

### 5.4 Deletion specifics

Current deletion capabilities that exist today:

- project-wide purge with preview and confirmation phrase:
  - `app/api/projects/[projectId]/purge/route.ts`
- run deletion:
  - `app/api/projects/[projectId]/runs/[runId]/route.ts`
- research-row scoped deletes and filtered bulk deletes:
  - `app/api/projects/[projectId]/research/route.ts`
- ad-asset single/bulk/delete-all within a run:
  - `app/api/projects/[projectId]/runs/[runId]/ad-assets/route.ts`
- run-scoped research-job deletion:
  - `app/api/projects/[projectId]/runs/[runId]/research-jobs/route.ts`
- run-scoped creative-job deletion:
  - `app/api/projects/[projectId]/runs/[runId]/creative-jobs/route.ts`
- additional scoped record deletes for product intel, customer avatars, products, and related entities

Project purge currently deletes:

- jobs
- research runs
- research rows
- Amazon reviews
- ad assets
- ad pattern results
- ad pattern references
- storyboards
- storyboard scenes
- image prompts
- scripts
- characters
- customer avatars
- product intel records
- product intelligence records
- usage events
- audit logs
- products
- the project row itself

Run deletion currently deletes:

- jobs within the run
- linked scripts
- linked storyboards
- linked research rows
- linked Amazon reviews
- linked ad assets
- linked ad pattern results
- linked audit logs
- linked characters
- linked product intel rows
- then the `research_run` row

Current limitations:

- tenant-wide delete/purge is not implemented
- storage-object cleanup is not guaranteed for every external file/object class on every delete path
- several delete paths are hard-delete paths rather than archive/soft-delete flows

### 5.5 Export specifics

Current export capabilities that exist today:

- project research CSV export:
  - `app/api/projects/[projectId]/research/export/route.ts`
- multiple UI-level CSV exports for research-hub and research-data views
- view-inputs and view-output pages expose structured job payloads/results for some job classes

Current limitations:

- there is no single full project export bundle that packages all project metadata, DB artifacts, and file references in one operation
- current exports are partial and data-class-specific
- export-before-delete is a policy target, not a fully implemented platform-wide flow

Current buyer-safe statement:

- export capability exists for some research and job-output surfaces
- a complete project-wide portability bundle does not yet exist

---

## 6) Threat model and risk posture

### 6.1 Cross-tenant data exposure

Primary mitigation:

- application-layer ownership checks
- project-scoped and user-scoped queries

Current gap:

- DB-layer isolation proof is not repo-verified
- endpoint-negative testing is still partial

### 6.2 Privileged/debug misuse

Primary mitigation:

- debug/admin access requires `DEBUG_ADMIN_TOKEN`
- some routes additionally use production-vs-non-production behavior

Current gap:

- privileged/debug surfaces should continue to be reviewed conservatively in production readiness reviews

### 6.3 Job poisoning or replay

Primary mitigation:

- job state machine
- idempotency keys on several job types
- route-side ownership checks before job creation

### 6.4 Data exfiltration via logs

Primary mitigation:

- some logging is structured
- obvious worker/service env-presence logs have been reduced

Current gap:

- secret-leak review is still partial
- sanitized failure handling is not yet fully consistent across the repo

### 6.5 Provider and scraping risk

Primary mitigation:

- explicit provider inventory and rotation runbook

Current gap:

- Reddit scraping strategy remains open and should not be represented as fully resolved

---

## 7) Audit logging

### 7.1 Audit log schema

The current database audit log model is `AuditLog` / `audit_log` with:

- `userId`
- `projectId`
- `jobId`
- `action`
- `metadata`
- `ip`
- `createdAt`

Schema source:

- `prisma/schema.prisma`
- `lib/logger.ts`

### 7.2 Logged events

Current exact repo-verifiable statement:

- audit logging exists
- it is not a complete centralized enterprise audit program
- event names are flexible strings rather than a fully locked enum

Events and sources currently visible in repo include:

- auth registration and auth error events
- project create and project error events
- job create and job error events
- entitlement denial events
- job-route audit writes across customer research, customer analysis, ad collection, transcripts, OCR, quality gate, pattern analysis, product collection/analysis, script generation, video prompts, video reviewer, and video upscaler flows
- upload/script-upload audit writes

Current implementation note:

- `lib/logger.ts` has a narrow base `AuditAction` type, but the implementation accepts arbitrary string actions
- this means the audit surface is broader than the base union type suggests

### 7.3 PII/logging posture

Current supportable statement:

- audit rows can include `ip`
- audit rows can include foreign keys to user/project/job
- metadata is flexible JSON
- application logs can still contain runtime error information and stacks

Current gap:

- there is not yet a fully closed proof that secrets cannot leak through every log/debug path

### 7.4 Retention

Current exact state:

- audit log retention is not governed by a formally enforced retention window in repo
- application log retention is similarly not documented as an enforced time-bounded program

This is still an open diligence item.

---

## 8) Secrets and key management

### 8.1 Current secret storage model

Current repo-visible model:

- local development uses environment files such as `.env.local`
- CI uses GitHub secrets
- deployed environments depend on deployment-provider environment configuration

### 8.2 Rotation summary

The canonical current runbook is `docs/SECRET_ROTATION_RUNBOOK.md`.

Current exact summary:

- seller-owned secrets must be replaced with buyer-owned secrets during transfer
- rotation order is:
  1. create buyer-owned replacement credentials
  2. update deployment env
  3. restart app/workers and validate flows
  4. revoke seller-owned credentials
  5. record rotation in handoff tracking

Provider groups explicitly covered by the runbook:

- database and auth secrets
- AWS/S3
- Anthropic
- KIE
- AssemblyAI
- Google Vision
- ElevenLabs
- Fal
- Apify
- OpenClaw-related integration secrets
- Stripe
- Redis
- debug/internal secrets such as `DEBUG_ADMIN_TOKEN`, `E2E_RESET_KEY`, `INTERNAL_API_SECRET`, and `INTERNAL_WEBHOOK_SECRET`

### 8.3 Prod vs dev separation

Current supportable statement:

- prod vs dev/provider-account separation is a policy target
- it is not yet fully enforced structurally across every provider

### 8.4 Least-privilege posture

Current buyer-safe statement:

- least-privilege intent is documented
- but the repo should not currently be represented as having exhaustive structural secret segmentation across all environments/providers

---

## 9) Compliance readiness snapshot

### 9.1 Delete/export readiness

Current state:

- project delete/purge: implemented
- run delete: implemented
- tenant-wide delete/purge: missing
- partial exports: implemented
- full project export bundle: missing

### 9.2 Retention readiness

Current state:

- data retention policy document exists
- explicit enforced audit/application log retention window does not yet exist

### 9.3 Operational documentation

Current state:

- secret rotation runbook exists
- incident response playbook: open
- access review process: open
- formal audit-log retention policy/enforcement: open

---

## 10) Current implementation inventory

Core auth/ownership:

- `lib/auth/requireSession.ts`
- `lib/getSessionUserId.ts`
- `lib/requireProjectOwner.ts`
- `lib/auth/requireProjectOwner404.ts`

Key deletion surfaces:

- `app/api/projects/[projectId]/purge/route.ts`
- `app/api/projects/[projectId]/runs/[runId]/route.ts`
- `app/api/projects/[projectId]/research/route.ts`
- `app/api/projects/[projectId]/runs/[runId]/ad-assets/route.ts`
- `app/api/projects/[projectId]/runs/[runId]/research-jobs/route.ts`
- `app/api/projects/[projectId]/runs/[runId]/creative-jobs/route.ts`
- `lib/projectPurge.ts`

Key export/data-access surfaces:

- `app/api/projects/[projectId]/research/export/route.ts`
- `app/api/projects/[projectId]/customer-analysis/[jobId]/route.ts`
- `app/api/projects/[projectId]/pattern-analysis/route.ts`
- `app/api/projects/[projectId]/run-summary/[runId]/route.ts`

Audit/logging:

- `lib/logger.ts`
- `lib/entitlements.ts`
- `prisma/schema.prisma`

Canonical supporting docs:

- `docs/SECURITY_GAPS.md`
- `docs/SECURITY_OVERVIEW.md`
- `docs/RLS_DISCLOSURE.md`
- `docs/DATA_RETENTION_POLICY.md`
- `docs/SECRET_ROTATION_RUNBOOK.md`

---

## 11) Known limits of this document

This document is intentionally conservative.

It does not claim:

- deployed RLS proof
- complete top-20 endpoint negative-test closure
- full project export portability
- tenant-wide purge
- formal incident response or access review maturity

Those items remain governed by the status in `docs/SECURITY_GAPS.md`.
