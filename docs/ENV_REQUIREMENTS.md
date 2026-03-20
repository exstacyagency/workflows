# Environment Requirements

This is the handoff checklist for environment variables that are actually required by the current codebase.

It is intentionally not a dump of every tuning flag. It focuses on:

- vars required for app startup
- vars required for login/auth
- vars required for storage
- vars required for any job that talks to an external provider
- what breaks if the var is missing

## How to use this document during transfer

Read this document in two layers:

1. use the env tiers below to understand what is needed for:
   - buyer demo / deterministic evaluation
   - minimum production deployment
   - full feature deployment
2. use the provider-specific sections after that to see:
   - which providers are essential vs optional
   - which exact jobs and features are disabled without each provider

This document is intended to reduce handoff ambiguity. Missing provider keys should be treated as intentionally disabling the affected flows, not as a vague partial-configuration state.

## Evaluation tiers

Use the env requirements in three different ways depending on what the buyer is trying to validate.

### 1. Minimum demo env

Use this when the goal is:

- local bring-up
- UI access
- deterministic golden evaluation
- basic repo walkthrough

Essential:

- `DATABASE_URL`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL` or `APP_URL`
- `AUTH_SECRET`
- `DEBUG_ADMIN_TOKEN`

Expected limitations:

- no real provider-backed research or generation flows
- no real storage-backed upload/media validation
- billing/provider integrations may remain untested

Best use case:

- deterministic buyer evaluation
- repo walkthrough
- basic local verification without standing up the full provider stack

### 2. Minimum production env

Use this when the goal is:

- deploy the app and worker in a realistic production shape
- support login, persistence, and the configured subset of live features

Essential baseline:

- all core runtime/auth vars
- queue/backend vars appropriate to the chosen queue mode
- storage vars for any flows that persist media or uploads
- provider vars only for the features intended to be live

Important note:

- production readiness does not require every optional provider
- but any feature whose provider is missing should be considered intentionally disabled, not partially working

Best use case:

- transfer where the buyer wants a live deployment quickly
- production deployment with a deliberately limited feature set enabled first

### 3. Full feature env

Use this when the goal is:

- exercise the full research + creative pipeline end to end
- validate the handoff as a fully transferable operating system, not just a deterministic contract repo

This requires:

- core runtime/auth vars
- all active storage buckets
- all research providers
- all creative/generation providers
- billing vars if billing is expected to operate

Best use case:

- full pipeline transfer
- buyer validation of research + creative + billing behavior as an integrated product

---

## Provider criticality summary

### Essential for any serious runtime

- `DATABASE_URL`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`
- `AUTH_SECRET`

Without these:

- the app cannot authenticate or persist data correctly

### Essential for deterministic buyer demo

- the core runtime/auth vars above
- `DEBUG_ADMIN_TOKEN`

Without this:

- golden/security-sweep style evaluation flows may be harder or impossible to exercise as documented

### Essential for full research feature coverage

- `APIFY_API_TOKEN`
- `ASSEMBLYAI_API_KEY`
- `GOOGLE_CLOUD_VISION_API_KEY`
- `ANTHROPIC_API_KEY`

Without these:

- ad collection, transcript extraction, OCR, customer analysis, pattern analysis, and several research-derived flows are disabled or fail fast

### Essential for full creative feature coverage

- `KIE_API_KEY`
- `KIE_API_BASE_URL`
- `KIE_CREATE_PATH`
- `KIE_STATUS_PATH`
- `KIE_LIVE_MODE`
- `FAL_API_KEY`
- `ELEVENLABS_API_KEY`
- `ANTHROPIC_API_KEY`

Without these:

- first-frame generation, video generation, merge/reviewer flows, audio swap, and several generation features are disabled or fail fast

### Essential for billing-enabled production

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_GROWTH`
- `STRIPE_PRICE_SCALE`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `APP_URL`

Without these:

- billing flows should be treated as disabled

### Optional or conditional

- Redis vars if `QUEUE_BACKEND=redis`
- public-base URL overrides for custom CDN/object-store setups
- model override vars
- bucket endpoint/region overrides when using non-default bucket layouts

These are not globally required, but they become required when the corresponding deployment shape or feature choice is active.

## Feature disablement summary

If these provider groups are missing, the following feature groups should be treated as disabled:

### Missing research providers

If `APIFY_API_TOKEN`, `ASSEMBLYAI_API_KEY`, `GOOGLE_CLOUD_VISION_API_KEY`, or `ANTHROPIC_API_KEY` are missing:

- customer research is incomplete or fails
- ad collection/transcripts/OCR/quality flows are incomplete or fail
- customer analysis and pattern analysis are incomplete or fail
- research-derived creative context becomes degraded or unavailable

### Missing creative providers

If `ANTHROPIC_API_KEY`, `KIE_*`, `FAL_API_KEY`, or `ELEVENLABS_API_KEY` are missing:

- script/storyboard/prompt generation may fail
- first-frame and video generation may fail
- merge/reviewer flows may fail
- character voice and audio-swap flows may fail

### Missing storage configuration

If required S3 vars are missing for the selected flow:

- uploads, mirrored media, frames, trimmed clips, or avatar outputs fail
- some UI flows may load metadata but fail on actual file persistence

### Missing billing configuration

If Stripe vars are missing:

- billing and subscription flows should be treated as disabled
- app/runtime flows that do not depend on billing can still be evaluated separately

## Core runtime

| Env var | Maps to | Required when | What breaks if missing |
| --- | --- | --- | --- |
| `DATABASE_URL` | Prisma / Postgres connection | Always in production | App cannot read or write data; production env validation fails. |
| `NEXTAUTH_SECRET` | NextAuth session signing secret | Always in production | Login/session handling breaks; production env validation fails. |
| `NEXTAUTH_URL` | Base auth URL / secure cookie behavior | Always in production | NextAuth callbacks and cookie behavior break; production env validation fails. |
| `AUTH_SECRET` | Alternate auth secret used by some auth helpers | Recommended to match `NEXTAUTH_SECRET` | Some auth/debug flows may fail or become inconsistent if only one secret is set. |
| `QUEUE_BACKEND` | Queue mode (`db` or `redis`) | Recommended to set explicitly | If omitted, queue code defaults to Redis in some paths; mis-set values break job enqueue/processing. |
| `REDIS_URL` | Redis queue connection | Required if `QUEUE_BACKEND=redis` | Background queue operations fail with `Redis not configured (REDIS_URL missing)`. |
| `APP_URL` | Billing success/cancel callback base URL | Required if Stripe billing is enabled | Checkout session creation fails with `Billing not configured`. |

## Storage / S3

These are the storage vars that matter for the active platform flows.

### Shared/default media bucket

| Env var | Maps to | Required when | What breaks if missing |
| --- | --- | --- | --- |
| `AWS_ACCESS_KEY_ID` | AWS credentials for all S3 uploads/signing | Any S3-backed flow | Uploads/signing fail or return `null`. |
| `AWS_SECRET_ACCESS_KEY` | AWS credentials for all S3 uploads/signing | Any S3-backed flow | Uploads/signing fail or return `null`. |
| `AWS_S3_REGION` | Default bucket region | Any default-bucket flow | Default S3 client cannot initialize correctly. |
| `AWS_S3_BUCKET` | Default media bucket | Any default-bucket flow | Ad video mirroring, OCR frame uploads, and swapped audio uploads fail. |

Default bucket is currently used by:

- ad video mirroring during ad collection
- OCR frame uploads
- audio swap output uploads

### Product setup bucket

| Env var | Maps to | Required when | What breaks if missing |
| --- | --- | --- | --- |
| `AWS_S3_BUCKET_PRODUCT_SETUP` | Product setup reference image bucket | Product setup image uploads, character avatar fallback | Product reference uploads fail; storyboard/product reference validation breaks; avatar upload falls back nowhere if no avatar bucket is configured. |
| `AWS_S3_REGION_PRODUCT_SETUP` | Product setup bucket region | Required if product setup bucket is not in `AWS_S3_REGION` | Reads/writes can fail or resolve to the wrong bucket URL. |
| `AWS_S3_ENDPOINT_PRODUCT_SETUP` | Product setup S3-compatible endpoint | Only if using non-AWS S3-compatible storage | Product setup URLs and uploads break against custom endpoints. |

Used by:

- product reference image upload
- product setup reference validation
- fallback destination for avatar character generation if no dedicated avatar bucket is set

### Avatar character bucket

| Env var | Maps to | Required when | What breaks if missing |
| --- | --- | --- | --- |
| `AWS_S3_BUCKET_AVATAR_CHARACTER_GENERATION` | Dedicated avatar image bucket | Required only if you want avatars separate from product setup | If missing, avatar uploads fall back to `AWS_S3_BUCKET_PRODUCT_SETUP`. |
| `AWS_S3_REGION_AVATAR_CHARACTER_GENERATION` | Avatar bucket region | Required only if avatar bucket is in a different region | Avatar URLs/signing/uploads can fail or point at wrong region. |
| `AWS_S3_ENDPOINT_AVATAR_CHARACTER_GENERATION` | Avatar bucket endpoint | Only for custom S3-compatible storage | Avatar upload/signing breaks on non-AWS object stores. |

Used by:

- character avatar generation output

### Video frame bucket

| Env var | Maps to | Required when | What breaks if missing |
| --- | --- | --- | --- |
| `AWS_S3_BUCKET_VIDEO_FRAMES` | First/last frame persistence bucket | `VIDEO_IMAGE_GENERATION` | First-frame job can fail with `S3 upload returned null`. |
| `AWS_S3_REGION_VIDEO_FRAMES` | Video frame bucket region | Required if different from `AWS_S3_REGION` | First/last frame persistence can fail or build wrong URLs. |
| `AWS_S3_ENDPOINT_VIDEO_FRAMES` | Video frame bucket endpoint | Only for custom object stores | Frame upload/signing breaks on non-AWS storage. |

Used by:

- `Generate First Frames` / `VIDEO_IMAGE_GENERATION`

### Trimmed clip bucket

| Env var | Maps to | Required when | What breaks if missing |
| --- | --- | --- | --- |
| `AWS_S3_BUCKET_TRIMMED_CLIPS` | Storyboard merge trimmed clip bucket | Storyboard merge / trimmed clip flow | Merge route fails with `Failed to upload trimmed clip`. |
| `AWS_S3_REGION_TRIMMED_CLIPS` | Trimmed clip bucket region | Required if different from `AWS_S3_REGION` | Trimmed clip uploads can fail or build wrong URLs. |
| `AWS_S3_ENDPOINT_TRIMMED_CLIPS` | Trimmed clip endpoint | Only for custom object stores | Trimmed clip upload breaks on non-AWS storage. |

Used by:

- storyboard merge / trimmed clip generation

## Anthropic

| Env var | Maps to | Required when | What breaks if missing |
| --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | Anthropic client for LLM jobs | Any Anthropic-backed feature | Script generation, storyboard generation, pattern analysis, product data collection, ad quality gate, swipe extraction, and related routes fail with `ANTHROPIC_API_KEY is not configured`. |
| `ANTHROPIC_MODEL` | General model override | Optional | Falls back to code defaults if missing. |
| `ANTHROPIC_HAIKU_MODEL` | Smaller-model override | Optional | Falls back to code defaults if missing. |
| `ANTHROPIC_SWIPE_MODEL` | Swipe extraction model override | Optional | Falls back to code defaults if missing. |
| `ANTHROPIC_QUALITY_MODEL` | Ad quality gate model override | Optional | Falls back to code defaults if missing. |

Directly affects:

- `CUSTOMER_ANALYSIS`
- `PATTERN_ANALYSIS`
- `SCRIPT_GENERATION`
- `STORYBOARD_GENERATION`
- `PRODUCT_DATA_COLLECTION`
- ad quality gate
- swipe metadata extraction

## Apify

| Env var | Maps to | Required when | What breaks if missing |
| --- | --- | --- | --- |
| `APIFY_API_TOKEN` | Main Apify API token | Ad collection and customer research | Apify-backed jobs skip or fail as `Apify not configured`. |
| `APIFY_TOKEN` | Legacy fallback token | Optional fallback | Only used if `APIFY_API_TOKEN` is missing. |
| `APIFY_TIKTOK_ACTOR_ID` | TikTok ad collection actor ID | Ad collection actor-run path | Ad collection cannot launch the TikTok actor. |
| `APIFY_DATASET_ID` | Existing dataset replay source | Only if reusing a dataset instead of actor runs | Ad collection cannot replay from a preset dataset. |
| `APIFY_DEFAULT_INDUSTRY_CODE` | Default ad-collection filter seed | Optional | Ad collection falls back to hardcoded default industry code. |

Directly affects:

- `AD_PERFORMANCE` ad collection
- `CUSTOMER_RESEARCH` Amazon review scraping

## AssemblyAI

| Env var | Maps to | Required when | What breaks if missing |
| --- | --- | --- | --- |
| `ASSEMBLYAI_API_KEY` | Transcript generation provider | Ad transcript jobs | Transcript routes and worker fail with `ASSEMBLYAI_API_KEY must be set`. |

Directly affects:

- `AD_PERFORMANCE` transcript extraction

## Google Vision

| Env var | Maps to | Required when | What breaks if missing |
| --- | --- | --- | --- |
| `GOOGLE_CLOUD_VISION_API_KEY` | OCR provider | Ad OCR jobs | OCR routes and worker fail with `GOOGLE_CLOUD_VISION_API_KEY must be set`. |

Directly affects:

- `AD_PERFORMANCE` OCR extraction

## KIE

| Env var | Maps to | Required when | What breaks if missing |
| --- | --- | --- | --- |
| `KIE_API_KEY` | KIE auth token | Video generation, first-frame generation, character avatar generation | Worker marks KIE-backed jobs failed or skipped as not configured. |
| `KIE_API_BASE_URL` | KIE API host | Any KIE-backed job | Requests fail immediately; wrong value can return HTML instead of API JSON. |
| `KIE_CREATE_PATH` | KIE create-task path | Any KIE-backed job using `kieHttp` | Task creation fails. |
| `KIE_STATUS_PATH` | KIE status path | Any KIE-backed job using `kieHttp` | Polling/status checks fail. |
| `KIE_LIVE_MODE` | Paid-run safety switch | First-frame generation and KIE image tasks | `VIDEO_IMAGE_GENERATION` refuses to run when not set to `1`. |
| `KIE_IMAGE_TO_VIDEO_MODEL` | Image-to-video model override | Optional | Video generation falls back to internal default if missing. |
| `KIE_TEXT_TO_VIDEO_MODEL` | Text-to-video model override | Optional | Video generation falls back to internal default if missing. |
| `KIE_CHARACTER_IMAGE_MODEL` | Character avatar model override | Optional | Character image generation falls back to `nano-banana-2`. |
| `KIE_CHARACTER_REFERENCE_MODEL` | Character reference model override | Optional | Character reference generation falls back to `sora-2-characters-pro`. |
| `VIDEO_IMAGE_PROVIDER_ID` | Default first-frame image provider | `VIDEO_IMAGE_GENERATION` | Wrong value sends first-frame jobs to the wrong provider/model. |

Directly affects:

- `VIDEO_IMAGE_GENERATION`
- `VIDEO_GENERATION`
- character avatar generation

## ElevenLabs

| Env var | Maps to | Required when | What breaks if missing |
| --- | --- | --- | --- |
| `ELEVENLABS_API_KEY` | ElevenLabs auth | Character voice setup and audio swap | Voice setup / audio swap fail with `ELEVENLABS_API_KEY is not configured`. |
| `ELEVENLABS_VOICE_ID` | Default fallback voice | Only if no per-character voice profile exists | Audio swap can fail with `No ElevenLabs voice ID`. |
| `ELEVENLABS_STS_MODEL` | STS model override | Optional | Falls back to internal default. |
| `ELEVENLABS_OUTPUT_FORMAT` | Output format override | Optional | Falls back to internal default. |

Directly affects:

- character voice setup
- `VIDEO_UPSCALER` audio swap

## FAL

| Env var | Maps to | Required when | What breaks if missing |
| --- | --- | --- | --- |
| `FAL_API_KEY` | FAL auth | Video merge, video review, legacy/video upscaler paths | Reviewer/upscaler/merge routes fail with `FAL is not configured` or `Missing required FAL configuration`. |

Directly affects:

- storyboard merge route
- video reviewer
- FAL-backed upscaler/reviewer flows

## Stripe

| Env var | Maps to | Required when | What breaks if missing |
| --- | --- | --- | --- |
| `STRIPE_SECRET_KEY` | Stripe server SDK | Billing checkout, portal, webhook handling | Billing routes fail with `Stripe is not configured`. |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook verification | Stripe webhook route | Subscription/webhook updates fail verification. |
| `STRIPE_PRICE_GROWTH` | Growth plan price ID | Billing enabled | Checkout route cannot resolve Growth plan price. |
| `STRIPE_PRICE_SCALE` | Scale plan price ID | Billing enabled | Checkout route cannot resolve Scale plan price. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Client-side Stripe publishable key | Hosted billing UI/client checkout | Frontend billing flows cannot initialize Stripe.js correctly. |
| `APP_URL` | Base callback URL for Stripe success/cancel redirects | Billing enabled | Checkout route returns `Billing not configured`. |

## Public URL / media signing notes

These are only needed if you use custom public bases or S3-compatible endpoints.

| Env var | Maps to | Required when | What breaks if missing |
| --- | --- | --- | --- |
| `S3_PRODUCT_SETUP_PUBLIC_BASE_URL` | Public base for product setup assets | Custom CDN/fronted bucket | Product setup asset URLs use raw S3 URL instead. |
| `S3_VIDEO_FRAMES_PUBLIC_BASE_URL` | Public base for frame images | Custom CDN/fronted bucket | Frame URLs use raw S3 URL instead. |
| `S3_TRIMMED_CLIPS_PUBLIC_BASE_URL` | Public base for trimmed clips | Custom CDN/fronted bucket | Trimmed clip URLs use raw S3 URL instead. |
| `S3_AVATAR_CHARACTER_GENERATION_PUBLIC_BASE_URL` | Public base for avatar assets | Custom CDN/fronted bucket | Avatar URLs use raw S3 URL instead. |

## Minimum env profiles

### Minimum demo env

This is the smallest practical env for buyer-oriented local bring-up and deterministic evaluation:

```env
DATABASE_URL=
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=
AUTH_SECRET=
DEBUG_ADMIN_TOKEN=
QUEUE_BACKEND=db
```

What this supports:

- app startup
- login/session behavior
- deterministic golden-style evaluation paths
- repo walkthrough without live external providers

What this does not support:

- real provider-backed research/generation
- realistic storage validation
- billing validation

### Minimum production env

This is the practical baseline for a deployment that intends to run real application flows, but not necessarily every feature:

```env
DATABASE_URL=
NEXTAUTH_URL=
NEXTAUTH_SECRET=
AUTH_SECRET=
QUEUE_BACKEND=db
APP_URL=

AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_S3_REGION=
AWS_S3_BUCKET=
AWS_S3_BUCKET_PRODUCT_SETUP=
```

Add these only for the features you intend to enable:

- research providers for research jobs
- creative providers for generation jobs
- Stripe vars for billing
- additional S3 bucket vars for frames, trimmed clips, and avatar separation

### Full feature env

This is the practical minimum for the platform to function across its current core flows end to end:

```env
DATABASE_URL=
NEXTAUTH_URL=
NEXTAUTH_SECRET=
AUTH_SECRET=
DEBUG_ADMIN_TOKEN=
QUEUE_BACKEND=db

AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_S3_REGION=
AWS_S3_BUCKET=
AWS_S3_BUCKET_PRODUCT_SETUP=
AWS_S3_BUCKET_AVATAR_CHARACTER_GENERATION=
AWS_S3_BUCKET_VIDEO_FRAMES=
AWS_S3_BUCKET_TRIMMED_CLIPS=

ANTHROPIC_API_KEY=
APIFY_API_TOKEN=
APIFY_TIKTOK_ACTOR_ID=
ASSEMBLYAI_API_KEY=
GOOGLE_CLOUD_VISION_API_KEY=

KIE_API_KEY=
KIE_API_BASE_URL=
KIE_CREATE_PATH=
KIE_STATUS_PATH=
KIE_LIVE_MODE=1
VIDEO_IMAGE_PROVIDER_ID=kie:nano-banana-2

ELEVENLABS_API_KEY=
FAL_API_KEY=

STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_GROWTH=
STRIPE_PRICE_SCALE=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
APP_URL=
```

What this supports:

- full research pipeline coverage
- full creative pipeline coverage
- billing-enabled runtime if Stripe is configured correctly

What still depends on buyer ops beyond env:

- app + worker deployment
- provider-account ownership transfer
- secret rotation
- production hardening and monitoring

## Current bucket mapping in this repo

As of the current code:

- default media bucket = `AWS_S3_BUCKET`
- product setup assets = `AWS_S3_BUCKET_PRODUCT_SETUP`
- avatar character generation = `AWS_S3_BUCKET_AVATAR_CHARACTER_GENERATION`
  - if missing, falls back to `AWS_S3_BUCKET_PRODUCT_SETUP`
- first/last generated frames = `AWS_S3_BUCKET_VIDEO_FRAMES`
- trimmed storyboard clips = `AWS_S3_BUCKET_TRIMMED_CLIPS`

## What is intentionally not listed here

These exist, but they are tuning or operational knobs:

- retry counts
- circuit breaker thresholds
- polling intervals
- runtime timeouts
- dev/test flags
- deployment mode toggles
