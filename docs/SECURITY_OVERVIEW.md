# Security Overview

This document summarizes the current authentication, authorization, and tenant-isolation posture of the repository for buyer diligence.

This file replaces an older audit snapshot that no longer reflected the current app-layer security model.

## Current short version

Current proven active control:
- authenticated application-layer ownership checks
- project-scoped and user-scoped queries in core API routes

Current RLS posture:
- RLS should not be represented as the active relied-upon isolation control
- deployed staging/production RLS enforcement is not repo-proven in this codebase audit

Buyer-safe statement:

> Tenant isolation is currently enforced primarily through authenticated API ownership checks and scoped database queries. Database-level RLS should not be represented as proven active isolation unless it is separately validated in the deployed environment.

## Authentication

Authentication is present in the current repository.

Representative mechanisms in active use:
- `getSessionUserId`
- `requireSession`
- NextAuth session-based request handling

Representative current route patterns include:
- authenticated project/job routes that require a session before returning data
- authenticated mutation routes that gate job creation behind ownership checks

This is materially different from the older repo snapshot that described the API surface as broadly unauthenticated.

## Authorization and ownership

Application-layer ownership checks are broadly present across project-scoped routes.

Representative helpers:
- `requireProjectOwner`
- `requireProjectOwner404`

Representative enforcement patterns:
- require a valid session
- verify the caller owns the target `projectId`
- scope database reads/writes by `projectId`
- additionally scope sensitive job reads by `userId` where applicable

Representative examples in the current repo:
- project job list/detail routes
- customer analysis output routes
- pattern analysis output routes
- run-scoped research/creative job routes

The current buyer-grade docs correctly treat this app-layer ownership model as the proven active control.

## Tenant model

The effective tenant boundary today is:
- `userId` owns one or more `projectId`s
- project-scoped artifacts are protected through session + ownership validation in API routes

Important nuance:
- many artifact tables remain linked primarily through `projectId` / `jobId`
- this is acceptable for app-layer enforcement
- it is not the same thing as independently enforced database multitenancy

## What is proven today

From the current checked-in repo and docs, the following are the strongest supportable statements:

- app-layer ownership checks are broadly implemented on project-scoped endpoints
- core job and artifact routes commonly use session checks plus project ownership checks
- selective no-leak behavior exists via `404` masking on some sensitive routes
- buyer-grade diligence docs now consistently describe app-layer isolation as the current proven model

## What is not yet proven or not yet complete

These items remain open, partial, or not repo-verifiable:

- database-level tenant isolation via RLS in staging/production
- exhaustive cross-tenant negative tests across the top sensitive endpoints
- exhaustive verification that all job-read endpoints return the correct no-leak `404/403` behavior
- structural separation of prod vs dev provider credentials across all external services
- exhaustive proof that secrets cannot leak through logs or debug surfaces
- audit log retention documentation
- incident response playbook documentation
- access review process documentation

## Current control maturity by area

### Done / repo-verified
- app-layer ownership checks on core project-scoped routes
- buyer-grade disclosure that app-layer isolation is the current proven model
- explicit disclosure that RLS is not currently repo-proven as the active control

### Partial
- cross-tenant negative testing exists, but not yet as a complete top-20 endpoint suite
- no-leak `404/403` behavior appears strong on key routes, but has not been exhaustively closed
- provider key separation and secret-leak review have supporting docs/guardrails, but are not fully closed

### Open or not repo-verifiable
- RLS policy proof and deployed enforcement proof
- tenant-wide purge
- full project-wide export bundle
- audit/incident/access-review operational docs

## How this document relates to the other security docs

This overview is intentionally high level.

For authoritative status and buyer diligence detail, use:
- `docs/SECURITY_GAPS.md` for the implementation checklist and status labels
- `docs/SECURITY_AND_DATA_ARCHITECTURE.md` for the trust-boundary and tenant-isolation model
- `docs/RLS_DISCLOSURE.md` for the conservative RLS statement

If any of those documents conflict with this file, update this file to match the newer buyer-grade audit posture rather than the historical pre-hardening snapshot.
