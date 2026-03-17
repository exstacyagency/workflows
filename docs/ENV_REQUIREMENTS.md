# Environment Requirements

This is the handoff checklist for environment variables that are actually required by the current codebase.

It is intentionally not a dump of every tuning flag. It focuses on:

- vars required for app startup
- vars required for login/auth
- vars required for storage
- vars required for any job that talks to an external provider
- what breaks if the var is missing

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

## Recommended minimum `.env` for a buyer

This is the practical minimum for the platform to function across its current core flows:

```env
DATABASE_URL=
NEXTAUTH_URL=
NEXTAUTH_SECRET=
AUTH_SECRET=
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

