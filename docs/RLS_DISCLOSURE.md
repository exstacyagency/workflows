# RLS Disclosure

This document clarifies the current tenant-isolation enforcement model for buyer diligence.

## Short version

Current active isolation control:
- application-layer ownership checks and project-scoped queries

Current RLS posture:
- RLS is referenced historically as installed
- RLS is **not** the control this repo currently relies on as the active enforcement mechanism
- production/staging RLS enforcement has not been repo-verified in this codebase audit

## What is actively enforcing access today

The primary enforcement mechanism is the application layer:

- session/auth checks
- project ownership checks
- route-level scoping by `projectId`
- route-level scoping by `userId` where applicable
- selective `404` behavior on missing/forbidden resources in several sensitive routes

Examples in the current repo include:

- `requireProjectOwner404`
- `requireProjectOwner`
- job reads scoped by `(id, userId)` or `(projectId, userId, jobId)`

This means the real tenant boundary today is enforced in API code, not by a documented, repo-verifiable database RLS control.

## What “RLS installed” means here

The security checklist historically marks:

- “RLS policy layer installed (functions + policies present in DB)”

But from the repo alone:

- the checked-in code does not provide enough evidence to independently confirm active deployed RLS enforcement
- the current application architecture documents app-layer checks as the practical isolation mechanism

Therefore the correct disclosure to a buyer is:

> The platform may have RLS-related work historically installed in the database environment, but the active and relied-upon isolation control in the current system is application-layer ownership enforcement.

## What this means for diligence

Buyer should evaluate the platform as:

- app-layer enforced multitenancy
- not DB-layer enforced multitenancy for diligence purposes unless the deployed database is separately validated

That distinction matters because:

- app-layer checks can be strong and deliberate
- but they are not the same thing as independently enforced row-level database isolation

## Current buyer-safe statement

The most accurate current statement is:

> Tenant isolation is enforced primarily through authenticated API ownership checks and project-scoped queries. RLS should not be represented as the active isolation control unless it is independently validated in the deployed database environment.

## What remains open

These items remain open or not fully verified:

- confirm RLS is enabled in staging and production
- confirm application session context is correctly mapped into DB-level enforcement
- run cross-tenant negative tests with RLS expected on
- document the deployed policies and validation evidence

## Why this disclosure exists

This document is intentionally conservative.

It is meant to prevent overstating the platform’s database isolation posture during a sale, licensing process, or buyer diligence review.
