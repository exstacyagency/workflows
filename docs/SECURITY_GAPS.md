# Security Gaps (Buyer-Grade Checklist)

This file is the authoritative implementation backlog for buyout/licensing readiness in the areas of:
- tenant isolation
- security posture
- data control
- infra portability
- compliance readiness

Each item must be either checked off or explicitly waived with rationale.

Audit note:
- Status annotations below were updated from a repo audit on March 17, 2026.
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
  Status: Not repo-verifiable. This remains checked historically, but the current repo does not contain enough checked-in SQL/policy evidence to re-confirm from code alone.
- [ ] RLS enforcement enabled on staging/prod (requires app session context + validation)
  Status: Open. No repo evidence of staging/prod validation or enforcement confirmation.
- [ ] Cross-tenant negative test suite for top 20 endpoints (read + write)
  Status: Partial. Access-control helpers exist, but no dedicated negative test suite was found.
- [ ] Confirm all "job read" endpoints return 404/403 consistently without leaking existence
  Status: Partial leaning Done. Spot checks show strong behavior on key job-read routes, but this has not been exhaustively verified across every job-read endpoint.

## Secrets & Key Management
- [x] Document secret rotation process (Neon, LLM, scrapers)
  Status: Done. A formal runbook now exists in `docs/SECRET_ROTATION_RUNBOOK.md`.
- [ ] Separate prod vs dev keys for external providers
  Status: Partial. Required production env has been documented and boot-time production assertions now fail on obvious dev/test values and local URL fallbacks, but provider accounts are not yet structurally separated by environment.
- [ ] Verify no secrets can be printed via logs or debug endpoints in prod
  Status: Partial. The obvious worker/service env-presence logs were removed, but the repo has not been exhaustively swept and some debug endpoints still exist outside the main worker paths.

## Data Deletion & Export
- [x] Project delete/purge endpoint (admin + owner)
  Status: Done. A project-wide admin+owner purge endpoint with preview and confirmation now exists at `app/api/projects/[projectId]/purge/route.ts`.
- [ ] Tenant delete/purge endpoint
  Status: Open. Not found.
- [ ] Project export bundle (JSON + file references)
  Status: Partial. Research export routes and CSV exports exist, but not a full project-wide export bundle across all artifact types.
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
  Status: Partial. Portability references exist across docs, but not as a complete buyer-grade target matrix/checklist.
