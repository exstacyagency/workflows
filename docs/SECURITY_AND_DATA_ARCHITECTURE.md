# Security & Data Architecture

**Status:** Draft (buyer-grade).  
**Scope:** This document defines the trust boundaries, tenant isolation model, data lifecycle, and security posture of the platform, and enumerates known gaps that must be closed for buyout/licensing readiness.

---

## 1) System Trust Boundaries

### 1.1 App/API Boundary (Next.js API routes)
- **Entry points:** `app/api/**`
- **Primary auth:** NextAuth session (cookie-based)
- **Project scoping:** Project owner checks (e.g., `requireProjectOwner`, `requireProjectOwner404`)
- **Admin debug access:** gated by debug token header and/or dev-only flags (document exact header names and conditions)

**Risks / Notes**
- Any endpoint that touches multi-tenant data must enforce ownership before returning data.
- Any endpoint that is "dev-only" must be explicitly disabled in production.

### 1.2 Worker Boundary
- **Entry points:** `workers/**`, `lib/workers/**`
- **Queue model:** DB-backed job state (PENDING/RUNNING/COMPLETED/FAILED)
- **Idempotency:** `idempotencyKey` used on several job types

**Risks / Notes**
- Worker must never process a job without verifying the job's `projectId` and ownership semantics in the API layer (workers should assume jobs are legitimate but must not leak cross-tenant data).

### 1.3 Database Boundary (Postgres / Neon)
- **Primary datastore:** Postgres (Neon in prod/dev, ephemeral Postgres in CI for golden)
- **Isolation:** currently enforced at application layer (document if RLS exists; if not, mark as a gap)
- **Migrations:** Prisma migrations under `prisma/migrations`

**Risks / Notes**
- App-layer scoping is necessary but not sufficient for many buyers; DB-level isolation (RLS or per-tenant DB/schema) is a major diligence item.

### 1.4 External Provider Boundary
List each provider that can receive data:
- **LLM(s):** (Anthropic/OpenAI/etc) - data types sent, redaction behavior, logging behavior
- **Scraping:** Apify / Reddit - what is fetched, how it's stored, how failures are handled
- **Storage/CDN:** (if any)

**Risks / Notes**
- External calls must be wrapped with sanitized error handling, no secrets in logs, and deterministic failure modes where possible.

---

## 2) Tenant Isolation Model

### 2.1 Tenant Definition
- A **tenant** is a `userId` (account) that owns one or more `projectId`s.

### 2.2 Enforcement Points
- API endpoints must:
  1) require session (`getSessionUserId`)
  2) require project ownership (`requireProjectOwner*`)
  3) only query rows scoped by `projectId`

### 2.3 What is Isolated Today
- Jobs scoped by `projectId` in API routes
- Project endpoints require ownership checks (document which ones)

### 2.4 What is Not Yet Isolated (must be explicit)
- [ ] Database-level isolation (RLS / per-tenant DB/schema)
- [ ] Cross-tenant negative tests for all sensitive endpoints
- [ ] "Debug" endpoints hardened/disabled in production (verify)

---

## 3) Data Classification

### 3.1 PII
- Emails, auth identifiers, IPs, device/session tokens

### 3.2 Customer/Client Inputs
- Product names, ASINs, research prompts, brand data, creatives

### 3.3 Generated Content
- Scripts, storyboards, images, videos, metadata

### 3.4 Scraped/Collected Data
- Reddit / ads / competitor data / transcripts

### 3.5 Logs & Audit Trails
- API audit logs (document schema + fields)
- Worker logs

---

## 4) Data Lifecycle

### 4.1 Creation
- Data originates from:
  - user input (UI/API)
  - workers (generated artifacts)
  - external providers (scraped or model outputs)

### 4.2 Storage
- Stored in Postgres with `projectId` association

### 4.3 Retention
- **Default retention:** TBD (set policy)
- **Logs retention:** TBD (set policy)

### 4.4 Deletion
- Current deletion capabilities:
  - TBD (document what exists)
- Required for readiness:
  - per-project purge
  - per-tenant purge
  - export before delete (optional depending on buyer)

### 4.5 Export
- Current export capabilities:
  - TBD
- Required:
  - project export bundle (JSON metadata + file references)

---

## 5) Threat Model (Short)

### 5.1 Cross-tenant data exposure
- Mitigation: ownership checks + scoped queries
- Gap: DB-level enforcement and negative tests

### 5.2 Privilege escalation
- Mitigation: remove/lock debug endpoints in production; least-privilege secrets

### 5.3 Job poisoning / replay
- Mitigation: idempotency keys, job guards, sanitized payload logging

### 5.4 Data exfiltration via logs
- Mitigation: sanitize external failure content; never log tokens; truncate bodies

### 5.5 Abuse / scraping risk
- Mitigation: rate limits, lockout, retries/backoff
- Gap: provider-compliant scraping strategy (Reddit auth, API usage, or remove)

---

## 6) Audit Logging

### 6.1 Logged Events
- Job create, job error, job complete (document exactly)
- Security sweep actions (if applicable)

### 6.2 PII in Logs
- IPs: [yes/no]
- Emails: [yes/no]
- External HTML bodies: must be sanitized/truncated

### 6.3 Retention
- TBD

---

## 7) Secrets & Key Management

### 7.1 Where secrets live
- GitHub repo secrets for CI
- `.env.local` for local dev

### 7.2 Rotation
- TBD (document minimum rotation plan for buyer)

### 7.3 Least Privilege
- Neon API key scope: project-limited
- Provider keys: restricted, separate prod/dev if possible

---

## 8) Compliance Readiness

### 8.1 GDPR-like delete/export
- Delete: [exists / missing]
- Export: [exists / missing]

### 8.2 SOC2 posture
- Access control: partial
- Audit trail: partial
- Change control: present (PR checks, freeze)
- Incident response: missing (document plan)

---

## 9) Current Implementation Inventory (Pointers)

### 9.1 Ownership checks
- `lib/requireProjectOwner*`
- `lib/auth/requireProjectOwner404` (if used)

### 9.2 Security sweep / attacker harness
- `scripts/attacker_sweep.mjs`
- `.github/workflows/security-sweep*.yml`

### 9.3 Golden + Freeze
- `.github/workflows/golden-e2e.yml`
- `.github/workflows/freeze-check.yml`
- `docs/FREEZE_CONTRACT.md`
- `docs/API_CONTRACT.md`

---

## 10) Known Gaps (Authoritative list)
See `docs/SECURITY_GAPS.md`.
