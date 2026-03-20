# Buyer Evaluation Guide

This document explains how to evaluate the repository honestly.

It is intentionally broader than the deterministic golden run. A serious buyer should use this guide to evaluate:

- contract stability
- local bring-up
- environment requirements
- worker/app runtime model
- current security posture
- current known gaps

---

## 1) Start with the right documents

Before running anything, read these first:

- `docs/README_BUYOUT.md`
  - buyer-facing overview of what is frozen, what deterministic evaluation proves, and what it does not prove
- `docs/SECURITY_GAPS.md`
  - authoritative backlog and status labels for security, deletion/export, portability, and compliance readiness
- `docs/SECURITY_OVERVIEW.md`
  - short current-state auth, ownership, and isolation summary
- `docs/SECURITY_AND_DATA_ARCHITECTURE.md`
  - canonical technical diligence document for trust boundaries, deletion, export, retention, logging, and secret posture
- `docs/RLS_DISCLOSURE.md`
  - explicit statement of what is and is not currently proven about RLS
- `docs/ENV_REQUIREMENTS.md`
  - actual environment-variable requirements and what breaks if they are missing

These docs are part of the evaluation surface. The goal is not just to run the app, but to understand what the repo currently proves and what it does not.

---

## 2) Understand what the repo currently proves

Current strong repo-backed evidence includes:

- deterministic contract behavior for the golden evaluation path
- freeze-contract enforcement on protected files and artifacts
- app-layer ownership enforcement as the current proven tenant-isolation control
- documented environment requirements
- documented project purge capability
- documented secret-rotation expectations

Current items that are still partial, open, or not repo-verifiable include:

- DB-layer RLS as a buyer-grade proven isolation control
- staging/production RLS enforcement proof
- complete top-20 cross-tenant negative test coverage
- exhaustive job-read no-leak verification
- tenant-wide purge
- full project export bundle
- formal incident-response/access-review maturity

Do not treat a passing golden run as proof that all of those are closed.

---

## 3) Clone and install

```bash
npm ci
```

If install fails, that is part of the evaluation signal.

---

## 4) Configure the environment honestly

For the minimum realistic env requirements, use:

- `docs/ENV_REQUIREMENTS.md`

At a bare minimum for deterministic evaluation, you will usually need:

- `DATABASE_URL`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL` or `APP_URL`
- `DEBUG_ADMIN_TOKEN`

But a broader runtime evaluation should also account for:

- provider keys for any real external-provider-backed jobs you plan to exercise
- storage configuration if you want to test upload/media flows
- queue configuration if you want to test non-default queue paths

The environment doc is the truth source for what is actually required and what fails when it is missing.

---

## 5) Understand the runtime model before you test

This repo is not just a Next.js app.

The current runtime model is:

- a Next.js application
- a separate background worker process
- a shared Postgres database

The worker is required for async job execution.

Key source:

- `README.md`

Important current fact:

- in production, the app and worker must both be running
- the worker is deployed separately from the app
- the worker does not need to be publicly accessible

If you only run the web app, large parts of the job pipeline will appear incomplete or broken because queued jobs will not process.

---

## 6) Run deterministic evaluation

Run:

```bash
SECURITY_SWEEP=1 npm run golden:run
```

Expected result:

- exits `0`
- prints `[golden] OK`

What this does:

- deterministic E2E bringup
- golden driver actions
- snapshot generation
- compare against the frozen baseline

What this proves:

- the checked deterministic evaluation path is reproducible
- the current frozen surface still matches the baseline
- contract-level drift is detectable

What this does not prove by itself:

- full production readiness
- full provider readiness
- full security maturity
- deployed-environment correctness

---

## 7) Confirm freeze enforcement

Attempt to modify a contract-protected artifact, for example a golden baseline file, in a PR.

Expected behavior:

- CI should fail unless the change is explicitly accompanied by the required override/bump process

Relevant docs:

- `docs/FREEZE_CONTRACT.md`
- `docs/CONTRACT_BUMP.md`
- `docs/API_CONTRACT.md`

This proves that the evaluation surface is intentionally controlled, not that the entire platform is feature-complete or fully enterprise-hardened.

---

## 8) Confirm required CI signals exist

On GitHub PRs, expected checks should include:

- `CodeQL`
- `freeze-check`
- `golden-e2e`
- `security-sweep`

Conservative interpretation:

- these are useful trust signals
- they are not a substitute for reading the security docs and known-gap checklist

---

## 9) Review security posture from the canonical docs

A serious buyer should explicitly verify the current security position from:

- `docs/SECURITY_OVERVIEW.md`
- `docs/SECURITY_AND_DATA_ARCHITECTURE.md`
- `docs/RLS_DISCLOSURE.md`
- `docs/SECURITY_GAPS.md`

The current buyer-safe security statement is:

- app-layer ownership enforcement is the currently proven isolation control
- RLS should not currently be represented as the active repo-proven control

That distinction matters and should be carried through any buyer memo or diligence summary.

---

## 10) Review current known gaps before drawing conclusions

The canonical truth source is:

- `docs/SECURITY_GAPS.md`

At evaluation time, pay special attention to:

- tenant isolation gaps
- deletion/export gaps
- portability gaps
- audit/compliance documentation gaps
- provider-risk gaps

If a buyer asks “what is still incomplete?”, answer from `docs/SECURITY_GAPS.md`, not from memory and not from marketing copy.

---

## 11) Evaluate deployment realism

For buyer realism, check whether the intended deployment model is understandable and transferable:

- app deployment
- worker deployment
- shared database dependency
- provider credentials and storage dependencies

Relevant docs:

- `README.md`
- `docs/ENV_REQUIREMENTS.md`
- `docs/SECRET_ROTATION_RUNBOOK.md`
- `docs/SECURITY_GAPS.md`

Current truthful statement:

- deployment shape is understandable from the repo
- but portability targets are not yet documented as a complete buyer-grade matrix

---

## 12) Honest evaluation summary

If the repo is being evaluated seriously, the correct framing is:

- deterministic evaluation proves contract stability and reproducible golden behavior
- the security docs describe the current proven app-layer posture and current open items
- the worker/app model must be understood to evaluate runtime behavior correctly
- the known-gaps doc remains the authoritative backlog for anything not yet closed

This document should be used as “how to evaluate this repo honestly,” not just “how to run golden.”
