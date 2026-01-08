# Security Gaps (Buyer-Grade Checklist)

This file is the authoritative implementation backlog for buyout/licensing readiness in the areas of:
- tenant isolation
- security posture
- data control
- infra portability
- compliance readiness

Each item must be either checked off or explicitly waived with rationale.

---

## Tenant Isolation
- [x] API ownership checks enforced on project-scoped endpoints (app-layer)
- [x] RLS policy layer installed (functions + policies present in DB)
- [ ] RLS enforcement enabled on staging/prod (requires app session context + validation)
- [ ] Cross-tenant negative test suite for top 20 endpoints (read + write)
- [ ] Confirm all "job read" endpoints return 404/403 consistently without leaking existence

## Secrets & Key Management
- [ ] Document secret rotation process (Neon, LLM, scrapers)
- [ ] Separate prod vs dev keys for external providers
- [ ] Verify no secrets can be printed via logs or debug endpoints in prod

## Data Deletion & Export
- [ ] Project delete/purge endpoint (admin + owner)
- [ ] Tenant delete/purge endpoint
- [ ] Project export bundle (JSON + file references)
- [ ] Data retention policy (artifacts + logs)

## External Providers
- [ ] Reddit strategy: official API + auth or remove/replace scraping path
- [ ] LLM redaction policy documented (what is sent, what is not)
- [ ] Provider failure handling is sanitized + truncated everywhere

## Audit & Compliance
- [ ] Audit log retention documented and enforced
- [ ] Minimal incident response playbook doc
- [ ] Access review process (who can access what)

## Infrastructure Portability
- [x] CI DB provisioning path (Neon or ephemeral Postgres for tests)
- [ ] One-command "fresh environment" bootstrap for buyers (local + CI)
- [ ] Document portability targets (Vercel, self-hosted, containers)
