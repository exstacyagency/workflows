# RLS Disclosure

This document is the canonical buyer-facing statement about row-level security (RLS) in the current repository.

## Current truth

The correct current statement is:

> RLS may exist historically or in some deployed database environments, but it is not the currently relied-upon, repo-proven tenant-isolation control for buyer diligence purposes.

For buyer diligence, the platform should currently be described as:

- app-layer enforced multitenancy
- not DB-layer-proven multitenancy

## What is proven today

The current proven active isolation control is the application layer:

- authenticated session checks
- project ownership checks
- project-scoped queries
- user-scoped queries on some job reads
- selective `404` masking on some sensitive routes

That is the control supported by the checked-in code and the current buyer-grade docs.

## What RLS is not being claimed to be

This repository should **not** currently claim any of the following without separate deployed-environment evidence:

- that RLS is the active relied-upon tenant-isolation control
- that staging RLS enforcement has been verified
- that production RLS enforcement has been verified
- that app session context is proven to map into DB-level policy enforcement
- that deployed RLS policies have been fully documented and validated for a buyer

## Why this disclosure is conservative

The repo contains historical RLS references, but not enough checked-in evidence to close buyer-grade proof from code alone.

Current repo limitations include:

- no buyer-grade checked-in proof of deployed policy inventory
- no repo-verifiable proof that staging/prod enforcement has been validated
- no repo-verifiable proof that session context is being applied into DB-level enforcement

Because of that, the buyer-safe posture is:

> Treat RLS as historical, partial, or environment-specific work unless it is separately proven outside the repo. Treat application-layer ownership enforcement as the current proven control.

## What a stronger future statement would require

This document can only be upgraded to “RLS is deployed and proven” if the following evidence exists:

- the deployed policy set is documented
- staging and production enforcement is validated
- the app-to-DB session-context mapping is documented and verified
- negative cross-tenant tests are run with expected DB-level deny behavior

Until then, the correct statement remains:

> RLS is not the currently relied-upon proven control in this repository audit.
