# Architecture Overview

## High-level components

### 1) API (Next.js app routes)
- Job creation endpoints: create job rows + payload
- Project endpoints: project-scoped resources
- Auth endpoints: NextAuth

### 2) Worker(s)
- Poll jobs from DB (PENDING/RUNNING/FAILED)
- Execute deterministic steps (in golden mode) or external calls (in real mode)
- Write job status/result summaries

### 3) Database (Prisma)
- Source of truth for:
  - Users / projects
  - Jobs and job payloads/results
  - Pipeline artifacts (scripts, storyboards, scenes, etc.)

## Pipeline (conceptual)
1. Research
2. Avatar & Product Intel
3. Pattern Brain
4. Script & Characters
5. Storyboards
6. Scenes & Review
7. Upscale & Export

## Deterministic evaluation path
The "golden" flow runs the pipeline in a deterministic mode:
- Bootstraps known users + a known project
- Runs a controlled set of API calls ("golden input")
- Snapshots DB state into a stable summary JSON
- Compares against `e2e/golden/baseline/summary.json`

## Guardrails
- Ownership checks for project/job access
- Rate limiting and concurrency guards
- Security sweep attacker harness (PR-safe + full sweep)
- Freeze contract enforcement
