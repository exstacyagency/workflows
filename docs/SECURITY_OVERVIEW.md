# Security Overview

This document captures the current authentication, authorization, and multitenancy posture of the FrameForge AI Studio repository as of today.

## Authentication & Session State
- `grep` searches across the repo (excluding dependencies) show **no usage** of NextAuth, Clerk, Auth0, Supabase, or other hosted auth SDKs, and no custom JWT/session helpers. The only reference to Auth0 is inside a dependency license file.
- None of the `app/api/**` handlers read cookies, headers, or tokens; every route is effectively unauthenticated and callable by any party that can reach the deployment.
- There is no concept of user accounts or workspaces in Prisma. Callers pass `projectId`, `storyboardId`, etc. directly in the request body/query string, so any user with an ID can operate on any tenant’s data.

## Data Model Tenant Scoping
The following Prisma models all contain tenant-specific artifacts (projects, jobs, research, creative assets). None of them include a `userId`, `workspaceId`, or similar ownership column—only cross-links to `Project`.

| Model | Should be tenant scoped? | Current ownership fields |
| --- | --- | --- |
| `Project` | Yes (top-level tenant container) | **None** |
| `Job` | Yes (per-project workflow state) | `projectId` only |
| `ResearchRow` | Yes (customer research) | `projectId`, `jobId` |
| `AdAsset` | Yes (ad creatives) | `projectId`, `jobId` |
| `AdPatternResult` | Yes (analysis output) | `projectId`, `jobId` |
| `AdPatternReference` | Yes (analysis rows) | `projectId`, `resultId` |
| `CustomerAvatar` | Yes (customer profiles) | `projectId`, `jobId` |
| `ProductIntelligence` | Yes (product profile) | `projectId`, `jobId` |
| `Character` | Yes (creative assets) | `projectId`, `jobId` |
| `Script` | Yes (creative assets) | `projectId`, `jobId` |
| `Storyboard` | Yes (creative assets) | `projectId`, `jobId`, `scriptId` |
| `StoryboardScene` | Yes (creative assets) | `storyboardId` (implicitly project-scoped) |

## API Route Assessment
Every handler currently runs without authentication or tenant validation. The table below summarizes the guardrails that are present or missing.

| Route | Methods | AuthN | Tenant / ownership checks | Input validation | Rate limiting |
| --- | --- | --- | --- | --- | --- |
| `/api/health` | GET | **Missing** | None | **Missing** | **Missing** |
| `/api/projects` | GET, POST | **Missing** | None | POST checks `name` only | **Missing** |
| `/api/projects/[projectId]/pattern-analysis` | GET | **Missing** | Requires `projectId` param, no ownership check | Checks param presence | **Missing** |
| `/api/projects/[projectId]/pattern-reference` | GET | **Missing** | Requires `projectId` param only | Param presence | **Missing** |
| `/api/projects/[projectId]/scripts` | GET | **Missing** | Requires `projectId` param only | Param presence | **Missing** |
| `/api/projects/[projectId]/customer-avatar` | GET | **Missing** | Requires `projectId` param only | Param presence | **Missing** |
| `/api/projects/[projectId]/customer-avatar/[avatarId]` | PATCH, DELETE | **Missing** | Ensures record exists but no caller ownership | Validates `action` enum | **Missing** |
| `/api/projects/[projectId]/product-intelligence` | GET | **Missing** | Requires `projectId` only | Param presence | **Missing** |
| `/api/projects/[projectId]/product-intelligence/[intelId]` | PATCH, DELETE | **Missing** | Ensures record exists; no tenant enforcement | Validates `action` enum | **Missing** |
| `/api/projects/[projectId]/research` | GET | **Missing** | Ensures project exists but not tied to user | No body validation | **Missing** |
| `/api/projects/[projectId]/characters` | GET | **Missing** | Requires `projectId` only | Param presence | **Missing** |
| `/api/jobs/customer-research` | POST | **Missing** | Requires `projectId` but trusts caller | Validates main fields | Uses `checkRateLimit(projectId)` |
| `/api/jobs/customer-analysis` | POST | **Missing** | Requires `projectId` but trusts caller | Validates field types loosely | **Missing** |
| `/api/jobs/ad-performance` | POST | **Missing** | Requires `projectId` but trusts caller | Validates `projectId` & `industryCode` | **Missing** |
| `/api/jobs/ad-transcripts` | POST | **Missing** | Requires `projectId` but trusts caller | Validates `projectId` | **Missing** |
| `/api/jobs/pattern-analysis` | POST | **Missing** | Requires `projectId` but trusts caller | Validates `projectId` | **Missing** |
| `/api/jobs/script-generation` | POST | **Missing** | Requires `projectId` but trusts caller | Validates `projectId` | **Missing** |
| `/api/jobs/character-generation` | POST | **Missing** | Requires `projectId` but trusts caller | Validates `projectId`, `productName` | **Missing** |
| `/api/jobs/video-images` | POST | **Missing** | Requires `storyboardId` but trusts caller | Validates `storyboardId` | **Missing** |
| `/api/jobs/video-prompts` | POST | **Missing** | Requires `storyboardId` but trusts caller | Validates `storyboardId` | **Missing** |
| `/api/jobs/video-reviewer` | POST | **Missing** | None | No body validation | **Missing** |
| `/api/jobs/video-upscaler` | POST | **Missing** | None | No body validation | **Missing** |
| `/api/jobs/[id]` | GET | **Missing** | Fetches job by ID, no ownership check | Param presence | **Missing** |

### Key Gaps
1. **Authentication:** Every endpoint is open. Introduce an auth provider (NextAuth, Clerk, custom JWT, etc.) before production use.
2. **Authorization / Multitenancy:** Requests need to assert the caller’s user or workspace and scope all queries (`projectId`, `jobId`, etc.) to that identity.
3. **Validation & Rate Limiting:** Aside from simple type checks and one `checkRateLimit` helper, there is no systematic validation layer (e.g., Zod/Valibot) or throttling. Background job triggers are especially vulnerable to abuse.
