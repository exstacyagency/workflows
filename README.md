# Ad Intelligence & Creative Automation Platform

A production-ready Next.js SaaS platform that runs a full AI-powered advertising pipeline: market research → customer analysis → script generation → storyboard → image/video generation → editing → delivery.

Built for DTC brands and performance marketing teams. Connects Amazon reviews, Reddit sentiment, competitor ad patterns, and product intelligence into a unified research layer, then generates complete video ad creatives end-to-end.

---

## What It Does

**Research Pipeline**
- Scrapes and aggregates Amazon reviews across main product + up to 3 competitors
- Collects Reddit posts and comments targeting problem-aware subreddits
- Ingests competitor ad creatives via Apify (copy, transcripts, OCR)
- Runs pattern analysis across collected ad data
- Generates structured customer avatar analysis via Anthropic

**Creative Pipeline**
- Generates video ad scripts from multiple strategy types (swipe template, research formula, etc.)
- Generates storyboards with scene-by-scene panel layouts
- Creates video prompts and first/last frame image references per scene
- Generates scene videos via KIE.ai
- Merges and optionally upscales final video output via Fal.ai
- Supports trim/merge editing in the UI before final export

**Platform Infrastructure**
- Full job queue with worker-based async execution
- Per-job cost tracking and billing settlement
- Subscription plan gating and quota enforcement
- Stripe billing with webhook handling
- Usage ledger with spend caps
- Dead-letter queue with admin retry/dismiss
- Audit logging on key operations

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15 (App Router), React, Tailwind CSS |
| Backend | Next.js API routes |
| Database | PostgreSQL via Prisma ORM |
| Job Worker | Node.js background worker (polling-based) |
| Auth | NextAuth.js (credentials + JWT) |
| Billing | Stripe (Checkout, Customer Portal, Webhooks) |
| Storage | AWS S3 (multiple buckets) |
| AI | Anthropic Claude (analysis, scripts, prompts) |
| Video | KIE.ai (generation), Fal.ai (merge, upscale) |
| Research | Apify (ad collection, scraping), AssemblyAI (transcripts), Google Vision (OCR) |
| Video Processing | ffmpeg (trimming) |

---

## Architecture Overview

```
Browser (Next.js App Router)
        │
        ▼
API Routes (app/api/**)
        │
        ├── Creates Job rows (PENDING) in Postgres
        ├── Enforces auth, ownership, plan gates, quota
        └── Returns job ID to client

Background Worker (workers/jobRunner.ts)
        │
        ├── Polls Postgres for PENDING jobs every 2s
        ├── Claims job atomically → RUNNING
        ├── Executes job handler by type
        ├── Calls external providers (Anthropic, KIE, Apify, etc.)
        ├── Writes results to DB + S3
        └── Settles cost → UsageEvent + job.actualCost

Billing Layer (lib/billing/*)
        ├── Quota reservation at job start
        ├── Spend cap check before provider calls
        └── Cost settlement at job completion
```

The worker runs as a **separate process** from the Next.js app. In production, both must be running simultaneously.

---

## External Services Required

### Required
| Service | Purpose | Env Var |
|---|---|---|
| PostgreSQL | Primary database | `DATABASE_URL` |
| Anthropic | Analysis, script, prompt generation | `ANTHROPIC_API_KEY` |
| AWS S3 | Media storage (videos, images, frames) | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` |
| KIE.ai | Video generation | `KIE_API_KEY`, `KIE_API_BASE_URL` |
| Fal.ai | Video merge and upscaling | `FAL_API_KEY` |
| Stripe | Billing and subscriptions | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| NextAuth | Authentication | `NEXTAUTH_SECRET` |

### Required for Research Features
| Service | Purpose | Env Var |
|---|---|---|
| Apify | Ad collection, Amazon review scraping | `APIFY_API_TOKEN` |
| AssemblyAI | Ad video transcript extraction | `ASSEMBLYAI_API_KEY` |
| Google Cloud Vision | Ad image OCR | `GOOGLE_CLOUD_VISION_API_KEY` |

### Optional
| Service | Purpose | Env Var |
|---|---|---|
| Redis | Alternative job queue backend | `REDIS_URL` |
| Reddit Scraper | Targeted subreddit scraping (self-hosted service) | `REDDIT_SCRAPER_URL` |
| ElevenLabs | Character voice generation | `ELEVENLABS_API_KEY` |
| ffmpeg | Video trimming before merge | `FFMPEG_PATH` |

> **Note on Reddit scraping:** The platform supports a self-hosted Reddit scraper service for targeted subreddit data collection (`REDDIT_SCRAPER_URL`). Without it, Reddit research falls back to sitewide search via Apify. For production use, deploying a Reddit scraper service at this endpoint significantly improves research quality by targeting problem-specific subreddits.

---

## Prerequisites

- Node.js 18+
- PostgreSQL 14+ (or Neon, Supabase, Railway)
- npm or yarn
- ffmpeg installed and on PATH (for video trimming)
- All required API keys from the services table above

---

## Setup

### 1. Clone and install

```bash
git clone <repo>
cd workflows
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in all required values in `.env`. See the [Environment Variables](#environment-variables) section below.

### 3. Set up the database

```bash
npx prisma migrate deploy
```

### 4. (Optional) Seed baseline data

```bash
npx tsx prisma/seed.ts
```

> Seed scripts refuse to run in production. Set `NODE_ENV` to something other than `production` for local setup.

### 5. Start the app

```bash
npm run dev
```

### 6. Start the worker (separate terminal)

```bash
npx dotenv -e .env -- npx tsx workers/jobRunner.ts
```

The worker must run alongside the app. It polls the database every 2 seconds for pending jobs and executes them.

---

## Production Deployment

### App (Vercel recommended)

Deploy the Next.js app normally. Set all environment variables in your Vercel project settings.

Required additional production env vars:
```
NODE_ENV=production
MODE=beta
NEXTAUTH_URL=https://yourdomain.com
APP_URL=https://yourdomain.com
AUTH_TRUST_HOST=true
```

### Worker

The worker is a long-running Node.js process. Deploy it separately from the Next.js app — on a VPS, Railway, Fly.io, or any service that supports persistent processes.

```bash
npx dotenv -e .env -- npx tsx workers/jobRunner.ts
```

Both the app and worker connect to the same `DATABASE_URL`. The worker does not need to be publicly accessible.

### Stripe Webhooks

Point your Stripe webhook to:
```
https://yourdomain.com/api/stripe/webhook
```

Required events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`

---

## Environment Variables

### Core

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `NEXTAUTH_SECRET` | ✅ | NextAuth session signing secret (min 32 chars) |
| `NEXTAUTH_URL` | ✅ | Full public URL of the app (e.g. `https://app.yourdomain.com`) |
| `APP_URL` | ✅ | Same as NEXTAUTH_URL |
| `MODE` | ✅ | Runtime mode — set to `beta` for production |
| `NODE_ENV` | ✅ | Set to `production` in production |
| `JWT_SECRET` | ✅ | JWT signing secret |

### Anthropic

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ | Anthropic API key |
| `ANTHROPIC_MODEL` | ❌ | Default model (e.g. `claude-3-5-sonnet-20241022`) |
| `ANTHROPIC_HAIKU_MODEL` | ❌ | Fast model for lighter tasks |
| `ANTHROPIC_QUALITY_MODEL` | ❌ | High-quality model for analysis |
| `ANTHROPIC_TIMEOUT_MS` | ❌ | Request timeout (default: 90000) |
| `ANTHROPIC_RETRIES` | ❌ | Retry attempts (default: 3) |

### AWS S3

| Variable | Required | Description |
|---|---|---|
| `AWS_ACCESS_KEY_ID` | ✅ | AWS access key |
| `AWS_SECRET_ACCESS_KEY` | ✅ | AWS secret key |
| `AWS_REGION` | ✅ | S3 region (e.g. `us-east-1`) |
| `AWS_S3_BUCKET` | ✅ | Main media bucket name |
| `AWS_S3_BUCKET_PRODUCT_SETUP` | ✅ | Product setup references bucket |
| `AWS_S3_ENDPOINT` | ❌ | Custom S3 endpoint (for non-AWS providers) |

### KIE.ai (Video Generation)

| Variable | Required | Description |
|---|---|---|
| `KIE_API_KEY` | ✅ | KIE.ai API key |
| `KIE_API_BASE_URL` | ✅ | KIE.ai API base URL |
| `KIE_CREATE_PATH` | ✅ | Path for video creation endpoint |
| `KIE_STATUS_PATH` | ✅ | Path for video status polling endpoint |
| `KIE_LIVE_MODE` | ❌ | Set to `true` to enable real video generation |
| `KIE_POLL_INTERVAL_MS` | ❌ | Polling interval (default: 5000) |
| `KIE_HTTP_TIMEOUT_MS` | ❌ | Request timeout |

### Fal.ai (Merge + Upscale)

| Variable | Required | Description |
|---|---|---|
| `FAL_API_KEY` | ✅ | Fal.ai API key |

### Stripe

| Variable | Required | Description |
|---|---|---|
| `STRIPE_SECRET_KEY` | ✅ | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | ✅ | Stripe webhook signing secret |
| `STRIPE_PRICE_GROWTH` | ✅ | Stripe price ID for Growth plan |
| `STRIPE_PRICE_SCALE` | ✅ | Stripe price ID for Scale plan |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | ✅ | Stripe publishable key (frontend) |

### Apify (Research)

| Variable | Required | Description |
|---|---|---|
| `APIFY_API_TOKEN` | ✅ | Apify API token |
| `APIFY_DATASET_ID` | ❌ | Default dataset ID |
| `APIFY_DEFAULT_INDUSTRY_CODE` | ❌ | Default industry for ad collection |

### AssemblyAI (Transcripts)

| Variable | Required | Description |
|---|---|---|
| `ASSEMBLYAI_API_KEY` | ✅ | AssemblyAI API key |

### Google Vision (OCR)

| Variable | Required | Description |
|---|---|---|
| `GOOGLE_CLOUD_VISION_API_KEY` | ✅ | Google Cloud Vision API key |

### Reddit Scraper (Optional)

| Variable | Required | Description |
|---|---|---|
| `REDDIT_SCRAPER_URL` | ❌ | URL of self-hosted Reddit scraper service (e.g. `http://localhost:5001`) |
| `REDDIT_USER_AGENT` | ❌ | User agent string for Reddit requests |

### Worker Tuning (Optional)

| Variable | Default | Description |
|---|---|---|
| `WORKER_JOB_MAX_RUNTIME_MS` | `300000` | Max job runtime before timeout |
| `JOB_RUNNING_STALE_MS` | `600000` | Time before a RUNNING job is considered stale |
| `MAX_JOB_ATTEMPTS` | `3` | Max retry attempts per job |
| `QUEUE_BACKEND` | `db` | Queue backend: `db` (default) or `redis` |

### Auth Tuning (Optional)

| Variable | Default | Description |
|---|---|---|
| `AUTH_MAX_ATTEMPTS` | `5` | Max failed login attempts before lockout |
| `AUTH_WINDOW_MS` | `900000` | Lockout window (15 min) |
| `AUTH_LOCKOUT_MS` | `1800000` | Lockout duration (30 min) |

---

## Job Types

The platform executes the following job types asynchronously via the worker:

| Job Type | Description |
|---|---|
| `CUSTOMER_RESEARCH` | Scrapes Reddit + Amazon reviews for a product |
| `CUSTOMER_ANALYSIS` | Generates customer avatar analysis from research |
| `PATTERN_ANALYSIS` | Analyzes collected ad patterns |
| `AD_PERFORMANCE` | Ad collection, OCR, and transcript extraction |
| `AD_QUALITY_GATE` | Quality scoring on collected ad data |
| `PRODUCT_DATA_COLLECTION` | Fetches product intelligence from a URL |
| `PRODUCT_ANALYSIS` | Structures product intel into findings |
| `SCRIPT_GENERATION` | Generates video ad scripts |
| `STORYBOARD_GENERATION` | Generates storyboard scenes from a script |
| `VIDEO_PROMPT_GENERATION` | Generates video prompts per scene |
| `VIDEO_IMAGE_GENERATION` | Generates first/last frame images |
| `VIDEO_GENERATION` | Generates scene videos via KIE.ai |
| `VIDEO_UPSCALER` | Upscales generated videos via Fal.ai |
| `VIDEO_REVIEW` | Post-processing review pass on clips |
| `CREATOR_AVATAR_GENERATION` | Generates creator avatar assets |
| `CHARACTER_SEED_VIDEO` | Generates character seed video |

---

## Database

The schema is managed via Prisma. Two migrations are included:

- `20260302000000_baseline` — full initial schema
- `20260302183000_usage_billing_pipeline` — usage and billing tables

```bash
# Check migration status
npx prisma migrate status

# Apply migrations
npx prisma migrate deploy

# Open Prisma Studio (local inspection)
npm run db:studio
```

---

## Scripts

Useful maintenance scripts in `scripts/`:

| Script | Purpose |
|---|---|
| `npm run env:db` | Print active database URL (redacted) |
| `npm run db:studio` | Open Prisma Studio |
| `npm run routes:manifest` | Generate API route inventory |
| `npx tsx scripts/prod_guardrails.ts` | Verify production safety checks |
| `npx tsx scripts/set-spend-cap.ts` | Set spend cap for a user account |
| `npx tsx scripts/set_password.ts` | Reset a user password directly |

---

## Security Notes

- All API routes enforce session authentication and project ownership checks
- Admin-only routes require a valid `DEBUG_ADMIN_TOKEN` header
- JWT secret is required at startup — will throw if missing
- Stripe webhook signature is verified on every webhook event
- Rate limiting is applied to auth routes (register, sign-in)
- Seeds and destructive scripts refuse to run in production
- Apify tokens are passed via `Authorization` header, not URL parameters
- S3 config is resolved dynamically at call time, not cached at import

---

## Plan Gating

Three subscription tiers are supported:

| Plan | Stripe Price Var | Features |
|---|---|---|
| Free | — | Limited research and generation quotas |
| Growth | `STRIPE_PRICE_GROWTH` | Increased quotas, full pipeline access |
| Scale | `STRIPE_PRICE_SCALE` | Highest quotas, all features |

Plan limits are defined in `lib/billing/quotas.ts`. Spend caps can be set per account via `scripts/set-spend-cap.ts`.

---

## Roadmap / Growth Opportunities

**OpenClaw Integration** presents an opportunity to position the platform as an autonomous operating layer for creative production, not just a workflow tool. By integrating an agent framework with persistent brand memory across research runs, teams could compound insight quality over time and reduce manual orchestration between stages.

**Social Listening & Trend Detection** creates a path to move from reactive research into proactive market intelligence. Real-time monitoring of emerging conversations and trends could help brands identify creative angles early and publish into demand before competitors adjust.

**Image Ad + Commercial Ad Integration** expands the addressable use case beyond short-form video into broader campaign execution. Supporting static image ads and longer-form commercial formats would open the platform to more budget types, more channels, and more full-funnel creative programs.

**Automatic Product Data** is a strong opportunity to reduce onboarding friction and increase throughput for teams managing many products. Pulling product details, pricing, and positioning directly from Shopify, Amazon, or product URLs would make the system easier to adopt and more valuable as a scalable intake layer.

**Performance Feedback Loop** would turn the platform into a learning system rather than a one-way generator. Connecting Meta and TikTok performance data back into the research layer could improve future creative decisions and create a measurable optimization story tied to business outcomes.

**Competitive Monitoring Agent** offers a recurring intelligence layer that can keep strategy current without manual review. A scheduled agent watching competitor ad libraries for new patterns, hooks, and messaging shifts would increase the platform's value between campaign launches, not only during active production.

**Multi-Brand Orchestration** opens a clear expansion path for agencies, aggregators, and multi-brand operators. Coordinating research and creative pipelines across multiple brands and product lines through agents would increase operational leverage and support higher-value enterprise workflows.

---

## License

See `LICENSE` file.
