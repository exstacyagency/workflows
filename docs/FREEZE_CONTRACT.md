# Freeze Contract

## Scope lock for buyout/licensing readiness

**Rule:** No new product features, models, workflows, or pipeline phases may be added until all items in:

- `docs/SECURITY_GAPS.md`

are either:
- checked off, or
- explicitly waived with written rationale in that file.

This freeze is intended to prevent scope drift and ensure diligence-critical work is completed before expanding surface area.

This repo enforces a "frozen surface" suitable for licensing/buyout evaluation.

## Enforced by CI
- `freeze-check` workflow
- `golden-e2e` workflow (deterministic snapshot compare)
- `security-sweep` workflow (PR-safe)
- Routes manifest checks

## Contract bump process
See `docs/CONTRACT_BUMP.md`.

## Purpose
This document defines **what must not change** (or must only change with explicit, auditable override) so the platform can be licensed/bought out and safely modified by a third party without relying on the original author.

The freeze is enforced by CI checks (see **Enforcement**).

---

## Definitions

### "External Contract"
Any behavior observed by:
- API clients (browser, SDKs, automation)
- Background workers calling internal job APIs
- CI golden tests and their snapshots

### "Internal Implementation"
Code refactors, performance improvements, model/provider swaps, and internal schema additions that **do not change external contract**.

---

## Freeze Scope (What is frozen)

### 1) API Surface Contract (HTTP)
Frozen artifacts:
- `docs/ROUTES_MANIFEST.txt` is the authoritative list of API routes.
- Each route's method + path is part of the contract.

Rules:
1. **No breaking route changes** without a Freeze Override:
   - No deleting or renaming routes.
   - No changing required params or response schema for existing routes.
2. New routes are allowed if:
   - They are additive (do not alter existing behavior).
   - They are documented in the route manifest baseline.

### 2) Job System Contract
Frozen behaviors:
- Job state machine semantics:
  - `PENDING` -> `RUNNING` -> (`COMPLETED` | `FAILED`)
- Idempotency semantics for job triggers:
  - Repeated trigger calls must be safe.
- Ownership semantics:
  - Cross-tenant reads/writes are forbidden.
  - Unauthorized access returns **404** when existence must not leak.

Rules:
1. Job read endpoints must not leak other users' job/project existence.
2. Job trigger endpoints must enforce ownership before billing/quota.
3. Error reporting must remain structured and safe (sanitized).

### 3) Deterministic Mode Contract (SECURITY_SWEEP / Golden)
Frozen behavior:
- When `SECURITY_SWEEP=1`:
  - No external paid calls (LLMs, scraping, etc.)
  - Deterministic placeholders returned for generation endpoints.
  - Attacker sweep + golden run must be stable.

Rules:
1. `SECURITY_SWEEP=1` must produce deterministic results.
2. Any drift in golden snapshot requires explicit override and baseline update.

### 4) Data Model Compatibility
Frozen expectations:
- Prisma migrations must apply cleanly on a fresh DB in CI.
- Existing migrations may not be edited (only new migrations added).

Rules:
1. Never rewrite history in `prisma/migrations/**`.
2. Schema changes are allowed only via new migrations.

---

## Allowed Changes Without Override
- Refactors that do not change external contract.
- Performance improvements.
- Adding optional fields to responses (additive only).
- Adding new routes (additive only) with manifest update.
- Adding new job types (additive only) without changing existing types semantics.

---

## Changes Requiring Freeze Override
These require an explicit override (see **Enforcement**):
- Any route removal/rename.
- Any required request field change.
- Any breaking response schema change.
- Any golden baseline update.
- Any job state semantics change.

---

## Enforcement (CI)
CI enforces:
1. Route manifest check: route inventory must match `docs/ROUTES_MANIFEST.txt`.
2. Freeze guard: PRs cannot change frozen assets unless override is set.
3. Golden regression: deterministic pipeline must match baseline.

Override mechanism:
- CI environment variable: `FREEZE_OVERRIDE=1`
- Intended only for controlled "contract bump" PRs.
