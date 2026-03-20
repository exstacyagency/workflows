# Security Gaps (Buyer-Grade Checklist)

This file is the authoritative implementation backlog for buyout/licensing readiness in the areas of:
- tenant isolation
- security posture
- data control
- infra portability
- compliance readiness

Each item must be either checked off or explicitly waived with rationale.

Audit note:
- Status annotations below were refreshed from a repo audit on March 20, 2026.
- Meanings:
  - `Done` = implemented and repo-verified
  - `Partial` = some supporting code/docs exist, but not enough to close the item
  - `Open` = not found or not sufficiently implemented
  - `Not repo-verifiable` = marked complete historically, but cannot be confirmed from checked-in code/docs alone

---

## Tenant Isolation
- [x] API ownership checks enforced on project-scoped endpoints (app-layer)
  Status: Done. Repo-wide app-layer ownership checks are broadly in place via helpers like `requireProjectOwner404`, `requireProjectOwner`, and route-level scoped queries.
- [x] RLS policy layer installed (functions + policies present in DB)
  Status: Not repo-verifiable. This remains checked historically, but the current repo does not contain enough checked-in SQL/policy evidence to prove an active buyer-grade RLS policy layer from code alone.
- [ ] RLS enforcement enabled on staging/prod (requires app session context + validation)
  Status: Open. No repo evidence was found proving staging/prod enforcement, app-to-DB session-context mapping, or deployed validation results.
- [ ] Cross-tenant negative test suite for top 20 endpoints (read + write)
  Status: Partial. Supporting negative-test assets exist in `scripts/attacker_sweep.mjs`, `tests/isolation.self-operator.test.ts`, and `.github/workflows/security-sweep-full.yml`, but they do not yet cover a buyer-grade top-20 endpoint matrix and were not verified as a complete always-green proof suite from the current repo state.
- [ ] Confirm all "job read" endpoints return 404/403 consistently without leaking existence
  Status: Partial. Spot checks show strong no-leak behavior on key job-read routes, but the repo does not yet contain an exhaustive verified inventory proving every job-read endpoint returns the intended `404/403` behavior consistently.

## Secrets & Key Management
- [x] Document secret rotation process (Neon, LLM, scrapers)
  Status: Done. A formal runbook now exists in `docs/SECRET_ROTATION_RUNBOOK.md`.
- [ ] Separate prod vs dev keys for external providers
  Status: Partial. Required production env has been documented and boot-time production assertions now fail on obvious dev/test values and local URL fallbacks, but provider accounts and credentials are not yet structurally separated by environment across the full provider set.
- [ ] Verify no secrets can be printed via logs or debug endpoints in prod
  Status: Partial. The obvious worker/service env-presence logs were removed and production guardrail checks exist for several debug routes, but the repo has not been exhaustively swept and there is not yet a closed proof that secrets cannot leak through all logs and debug surfaces.

## Data Deletion & Export
- [x] Project delete/purge endpoint (admin + owner)
  Status: Done. A project-wide admin+owner purge endpoint with preview and confirmation now exists at `app/api/projects/[projectId]/purge/route.ts`.
- [ ] Tenant delete/purge endpoint
  Status: Open. Not found.
- [ ] Project export bundle (JSON + file references)
  Status: Partial. Research export routes and multiple CSV/data-view exports exist, but not a full project-wide export bundle across all artifact types and file references.
- [x] Data retention policy (artifacts + logs)
  Status: Done. A written retention policy now exists in `docs/DATA_RETENTION_POLICY.md`.

## External Providers
- [ ] Reddit strategy: official API + auth or remove/replace scraping path
  Status: Open. Reddit scraping paths are still active.
- [x] LLM redaction policy documented (what is sent, what is not)
  Status: Done. A written policy now exists in `docs/LLM_REDACTION_POLICY.md`.
- [ ] Provider failure handling is sanitized + truncated everywhere
  Status: Partial. Some good patterns exist, especially for KIE/external-call wrappers, but this is not consistent across the repo.

## Audit & Compliance
- [ ] Audit log retention documented and enforced
  Status: Open. Not found.
- [ ] Minimal incident response playbook doc
  Status: Open. Not found.
- [ ] Access review process (who can access what)
  Status: Open. Not found.

## Infrastructure Portability
- [x] CI DB provisioning path (Neon or ephemeral Postgres for tests)
  Status: Done. Repo/docs evidence supports the current checked status.
- [x] One-command "fresh environment" bootstrap for buyers (local + CI)
  Status: Done. A one-command local bootstrap now exists via `npm run bootstrap:local` backed by `scripts/bootstrap-local.sh`, `.env.example`, and bootstrap docs in `README.md`.
- [ ] Document portability targets (Vercel, self-hosted, containers)
  Status: Partial. The README documents Vercel for the app plus separate worker deployment on VPS/Railway/Fly.io, but the repo still lacks a complete buyer-grade portability target matrix covering all supported deployment shapes.
