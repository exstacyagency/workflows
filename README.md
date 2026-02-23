# FrameForge AI Studio

An AI-powered video production platform for creating cinematic advertisements. This system orchestrates a complete 7-phase workflow from market research to final video delivery.

## Codebase Structure

### Main Directories

- **`/app`** - Next.js App Router with pages and API routes
  - `page.tsx` - Studio Command Center (home page with project overview)
  - `projects/` - Projects management pages
  - `customer-profile/` - Customer profile related pages
  - `api/` - RESTful API endpoints organized by domain:
    - `api/projects/` - Project CRUD operations
    - `api/jobs/` - Job management (status tracking, results)
    - `api/jobs/[id]/` - Individual job details with linked data

- **`/lib`** - Core business logic services (11 service files)
  - `prisma.ts` - Singleton Prisma client with connection pooling
  - Service files implementing the 7-phase production pipeline:
    1. `customerAnalysisService.ts` - Customer research and avatar analysis
    2. `adPatternAnalysisService.ts` - Pattern brain analysis
    3. `adRawCollectionService.ts` - Ad asset collection
    4. `adTranscriptCollectionService.ts` - Ad transcription
    5. `scriptGenerationService.ts` - Script generation with pattern stacking
    6. `characterGenerationService.ts` - Character/persona generation
    7. `videoImageGenerationService.ts`, `videoPromptGenerationService.ts`, `videoReviewerService.ts`, `videoUpscalerService.ts` - Video generation pipeline

- **`/components`** - Reusable React components
  - `Sidebar.tsx` - Fixed navigation sidebar with FrameForge AI branding
  - `TopBar.tsx` - Header component for pages

- **`/services`** - Standalone service utilities
  - `customerResearchService.ts` - Phase 1A research job logic (Reddit + Amazon scraping via Apify)

- **`/prisma`** - Database schema and migrations
  - `schema.prisma` - Complete data models (13 models)
  - `migrations/` - Schema evolution tracking (11 migration files)

## Technology Stack

### Frontend
- **Next.js 14** (App Router) - React framework with file-based routing
- **React 18.3** - UI library with hooks
- **TypeScript 5.6** - Type safety
- **Tailwind CSS 3.4** - Utility-first styling (dark theme with slate palette)
- **PostCSS + Autoprefixer** - CSS processing

### Backend
- **Node.js** (via Next.js API Routes)
- **Prisma 5.22** - ORM with migrations

### Database
- **PostgreSQL** - Primary relational database

### External APIs
- **Apify API** - Web scraping actor platform for Reddit/Amazon data
- **Reddit JSON API** - Direct Reddit search access
- **Amazon Product API** - Review scraping (via Apify)

## 7-Phase Production Pipeline

The system models a complete video production workflow:

1. **Phase 1A: Customer Research** - Reddit + Amazon review scraping via Apify
2. **Phase 1B: Analysis** - Customer avatar and product intelligence extraction
3. **Phase 2: Pattern Analysis** - Ad pattern brain analysis
4. **Phase 3: Script Generation** - Script generation with character creation
5. **Phase 4: Video Generation** - Image generation, video prompts, and review
6. **Phase 5: Upscaling** - Video upscaling for final delivery
7. **Phase 7: Export** - Final export and delivery

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│              Next.js 14 (Frontend + Backend)             │
├─────────────────────────────────────────────────────────┤
│  Pages (React Components) | API Routes (Node.js)        │
│  - page.tsx              | - /api/projects              │
│  - projects/page.tsx     | - /api/jobs/*               │
│  - customer-profile/     | - /api/projects/[id]/*      │
└─────────────────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────────────────┐
│          Service Layer (Business Logic)                 │
├─────────────────────────────────────────────────────────┤
│  • customerResearchService.ts (Phase 1A)               │
│  • customerAnalysisService.ts (Phase 1B)               │
│  • adPatternAnalysisService.ts (Phase 2)               │
│  • scriptGenerationService.ts (Phase 3)                │
│  • characterGenerationService.ts (Phase 3)             │
│  • videoImageGenerationService.ts (Phase 4)            │
│  • videoPromptGenerationService.ts (Phase 4)           │
│  • videoReviewerService.ts (Phase 4)                   │
│  • videoUpscalerService.ts (Phase 5)                   │
└─────────────────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────────────────┐
│      Prisma ORM (Data Access Layer)                     │
├─────────────────────────────────────────────────────────┤
│  - Singleton client (lib/prisma.ts)                     │
│  - Type-safe queries                                    │
└─────────────────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────────────────┐
│          PostgreSQL Database                            │
├─────────────────────────────────────────────────────────┤
│  13 Models: Project, Job, ResearchRow, AdAsset,        │
│  AdPattern*, Customer*, Character, Script, Storyboard  │
└─────────────────────────────────────────────────────────┘
```

## Database Schema

### Key Models

| Model | Purpose | Relations |
|-------|---------|-----------|
| **Project** | Brand/product container | 1:N to Jobs, ResearchRows, AdAssets, Characters, Scripts |
| **Job** | Workflow execution tracking | 1:N to ResearchRows, AdAssets, Characters, Scripts |
| **ResearchRow** | Individual Reddit/Amazon insight | N:1 to Project, Job |
| **AdAsset** | Ad creative (video/image) | N:1 to Project, Job |
| **CustomerAvatar** | Customer persona snapshot | N:1 to Project, Job |
| **ProductIntelligence** | Product analysis | N:1 to Project, Job |
| **Character** | Video character/actor | N:1 to Project, Job |
| **Script** | Generated video script | 1:N to Storyboards |
| **Storyboard** | Visual breakdown | 1:N to StoryboardScenes |
| **StoryboardScene** | Individual scene | Image/video prompts |
| **AdPatternResult** | Pattern analysis results | 1:N to PatternReferences |
| **AdPatternReference** | Individual pattern found | N:1 to AdPatternResult |

### Enums
- **JobType**: CUSTOMER_RESEARCH, AD_PERFORMANCE, PATTERN_ANALYSIS, SCRIPT_GENERATION, STORYBOARD_GENERATION, CUSTOMER_ANALYSIS, CHARACTER_GENERATION, VIDEO_IMAGE_GENERATION, VIDEO_PROMPT_GENERATION, VIDEO_REVIEW
- **JobStatus**: PENDING, RUNNING, COMPLETED, FAILED
- **ResearchSource**: REDDIT_PRODUCT, REDDIT_PROBLEM, AMAZON_PRODUCT_5_STAR, AMAZON_PRODUCT_4_STAR, AMAZON_COMPETITOR_1, AMAZON_COMPETITOR_2
- **AdPlatform**: TIKTOK, META

## API Routes

### Projects
- `GET /api/projects` - Fetch all projects
- `POST /api/projects` - Create project
- `GET /api/projects/[projectId]/research` - Fetch research rows

### Jobs
- `POST /api/jobs/customer-research` - Start research job
- `POST /api/jobs/customer-analysis` - Customer analysis
- `POST /api/jobs/ad-performance` - Ad performance analysis
- `POST /api/jobs/ad-transcripts` - Ad transcript collection
- `POST /api/jobs/pattern-analysis` - Pattern brain analysis
- `POST /api/jobs/script-generation` - Script generation
- `POST /api/jobs/character-generation` - Character generation
- `POST /api/jobs/video-images` - Video frame generation
- `POST /api/jobs/video-prompts` - Video prompt generation
- `POST /api/jobs/video-reviewer` - Video review
- `POST /api/jobs/video-upscaler` - Video upscaling
- `GET /api/jobs/[id]` - Fetch job status + results

## Running Locally

1. **Prerequisites**: Node 20+ and PostgreSQL

2. **Environment Setup**: Copy `.env.example` to `.env` and configure:
   ```
   DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DBNAME"
   APIFY_TOKEN="your-apify-token"
   ```

3. **Install Dependencies**:
   ```bash
   npm install
   ```

4. **Database Setup**:
   ```bash
   npx prisma generate
   npx prisma migrate dev
   ```

5. **Start the Application Services** (run each command in a separate terminal):
   ```bash
   npm run dev
   npm run worker
   cd services/reddit-scraper && python3 flask_api.py
   ```

### Worker Runtime Note (TODO before go-live)

- OCR extraction (`ad_ocr_collection`) requires `ffmpeg` in the worker runtime.
- Local developer workers need `ffmpeg` installed in PATH.
- Production should run the worker in Docker/Railway/Render (or equivalent) with `ffmpeg` preinstalled so end users do not need local setup.
- Transcript extraction (`ad_transcript_collection`) uses AssemblyAI and requires:
  - `ASSEMBLYAI_API_KEY`

6. **Access the Application**: Open http://localhost:3000

## Frontend Entry Points

- `/` - Studio Command Center (project overview with pipeline milestones)
- `/projects` - Create and manage projects
- `/projects/[projectId]` - Individual project dashboard
- `/customer-profile` - Customer insights

## Key Files

| File | Purpose |
|------|---------|
| `package.json` | Dependencies and scripts |
| `tsconfig.json` | TypeScript configuration with path aliases |
| `prisma/schema.prisma` | Database schema definition |
| `next.config.mjs` | Next.js configuration |
| `tailwind.config.cjs` | Tailwind CSS configuration |
| `.env.example` | Environment variable template |

## Development Guidelines

The codebase follows a **service-oriented architecture** with clear separation of concerns:
- **UI Components** - Reusable React components for presentation
- **API Routes** - Thin adapters that delegate to service layer
- **Service Layer** - Core business logic for each pipeline phase
- **Data Access** - Type-safe Prisma ORM queries

Each phase of the production pipeline is modular and can be extended independently.

ci smoke 2026-01-02T20:10:01Z
ci smoke 2026-01-02T20:59:58Z

## Entitlement Gate – Verification Instructions

### Mandatory Test Execution

Linting and builds are insufficient to validate entitlement enforcement. Always run the entitlement bypass test suite.

#### Run the entitlement bypass test

```bash
npm test
# or
npx jest tests/entitlements.bypass.test.ts
```

#### Expected success output

```
PASS tests/entitlements.bypass.test.ts
Test Suites: 1 passed, 1 total
Tests:       1 passed, 1 total
```

#### One-time validation (do NOT commit)

1. Temporarily modify the entitlement gate to always return `{ allowed: true }`.
2. Re-run `npx jest tests/entitlements.bypass.test.ts` and confirm it fails.
3. Immediately revert the change.

#### CI requirement

- CI must execute Jest for entitlement coverage. A green build without tests is invalid.

#### Definition of done

- Entitlement test runs locally.
- Tampered gate fails the test.
- Correct logic passes the test.
- CI runs the Jest suite.
