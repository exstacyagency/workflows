# Secret Rotation Runbook

This document describes the current secret inventory for the platform, who should own each secret, and the minimum safe rotation process before and after a transfer of ownership.

## Ownership model

- Before transfer: seller controls all provider accounts and secrets.
- At transfer: buyer should create or take ownership of every provider account listed below.
- After transfer: seller-owned secrets must be revoked or replaced.

Operational rule:
- Do not transfer a live platform to a buyer while seller-owned provider keys remain active in production.

## Rotation order

Rotate in this order to avoid downtime:

1. Create buyer-owned replacement credentials.
2. Add replacement secrets to deployment env.
3. Restart app/workers and validate core flows.
4. Revoke seller-owned secrets.
5. Record rotation date and owner in the buyer handoff sheet.

## Secret inventory

### Database and auth

| Secret / env var | What it controls | Owner after transfer | Rotation method | What breaks if missing or invalid |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | Postgres / Neon database connection | Buyer infra owner | Create new DB user/password or new DB, update env, redeploy, revoke old DB credentials | App cannot read/write data |
| `NEXTAUTH_SECRET` | Session signing | Buyer app owner | Generate a new random secret, update env, restart app | Sessions/auth break |
| `AUTH_SECRET` | Alternate auth secret used by some runtime paths | Buyer app owner | Set to same new value as `NEXTAUTH_SECRET` unless intentionally separated | Some auth/debug flows may fail or diverge |
| `DEBUG_ADMIN_TOKEN` | Dev/admin debug access | Buyer app owner | Generate new random token, update env, restart app | Debug/admin helper routes may remain accessible with seller-known token if not rotated |
| `E2E_RESET_KEY` | Test/reset helper access | Buyer app owner | Generate new random token, update env | Test reset endpoints remain callable with seller-known token if not rotated |
| `INTERNAL_API_SECRET` | Internal service-to-service auth | Buyer app owner | Generate new random token, update env everywhere it is used | Internal endpoints/webhooks fail or remain exposed |
| `INTERNAL_WEBHOOK_SECRET` | Internal webhook auth | Buyer app owner | Generate new random token, update env everywhere it is used | Internal webhook verification fails |

### Storage / AWS / S3

| Secret / env var | What it controls | Owner after transfer | Rotation method | What breaks if missing or invalid |
| --- | --- | --- | --- | --- |
| `AWS_ACCESS_KEY_ID` | S3 access | Buyer cloud/storage owner | Create new IAM user or access key, update env, restart app/workers, revoke old key | Uploads and signed URLs fail |
| `AWS_SECRET_ACCESS_KEY` | S3 access | Buyer cloud/storage owner | Rotate with `AWS_ACCESS_KEY_ID` | Uploads and signed URLs fail |

Note:
- Bucket names/regions are configuration, not secrets, but they should also be reviewed during handoff.

### LLM and generation providers

| Secret / env var | What it controls | Owner after transfer | Rotation method | What breaks if missing or invalid |
| --- | --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | Anthropic LLM calls | Buyer AI/provider owner | Create new API key in buyer workspace, update env, restart app/workers, revoke old key | Script generation, storyboard generation, pattern analysis, product data collection, ad quality gate, and other Anthropic flows fail |
| `KIE_API_KEY` | KIE image/video/character generation | Buyer AI/provider owner | Create new API key, update env, restart app/workers, revoke old key | First-frame, video generation, and character image flows fail |
| `ASSEMBLYAI_API_KEY` | Transcript generation | Buyer AI/provider owner | Create new API key, update env, restart app/workers, revoke old key | Ad transcript collection fails |
| `GOOGLE_CLOUD_VISION_API_KEY` | OCR detection | Buyer AI/provider owner | Create new key in buyer GCP project, restrict appropriately, update env, restart app/workers, revoke old key | OCR collection fails |
| `ELEVENLABS_API_KEY` | Voice setup / audio swap | Buyer AI/provider owner | Create new API key, update env, restart app/workers, revoke old key | Character voice setup and audio swap fail |
| `FAL_API_KEY` | FAL-backed media flows | Buyer AI/provider owner | Create new API key, update env, restart app/workers, revoke old key | Merge/reviewer/FAL-backed media flows fail |

### Scraping / collection providers

| Secret / env var | What it controls | Owner after transfer | Rotation method | What breaks if missing or invalid |
| --- | --- | --- | --- | --- |
| `APIFY_API_TOKEN` | Apify collection jobs | Buyer data/provider owner | Create new API token, update env, restart app/workers, revoke old token | Ad collection and Apify-backed research flows fail |
| `APIFY_TOKEN` | Legacy fallback Apify token | Buyer data/provider owner | Remove if unused, otherwise rotate same as `APIFY_API_TOKEN` | Legacy fallback paths fail |
| `OPENCLAW_GATEWAY_TOKEN` | OpenClaw integration | Buyer integration owner | Issue replacement token, update env, restart app, revoke old token | OpenClaw integration fails |
| `OPENCLAW_WEBHOOK_SECRET` | OpenClaw webhook verification | Buyer integration owner | Generate new secret, update env on both sides, revoke old secret | Webhook verification fails |

### Billing

| Secret / env var | What it controls | Owner after transfer | Rotation method | What breaks if missing or invalid |
| --- | --- | --- | --- | --- |
| `STRIPE_SECRET_KEY` | Stripe server API | Buyer billing owner | Use buyer Stripe account secret key, update env, restart app, revoke seller key | Billing checkout/portal/server billing actions fail |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook verification | Buyer billing owner | Recreate endpoint or update signing secret in buyer Stripe account, update env | Billing webhooks fail verification |

### Queue / infrastructure

| Secret / env var | What it controls | Owner after transfer | Rotation method | What breaks if missing or invalid |
| --- | --- | --- | --- | --- |
| `REDIS_URL` | Redis queue backend | Buyer infra owner | Issue new Redis password/URL or new instance, update env, restart app/workers, revoke old creds | Redis-backed queue operations fail |

## Provider account checklist

These are not always a single env var, but they must become buyer-controlled:

- Neon / Postgres
- AWS / S3 buckets
- Anthropic
- KIE
- Apify
- AssemblyAI
- Google Cloud Vision
- ElevenLabs
- FAL
- Stripe
- Redis provider
- Domain / DNS
- Email provider

## Prod vs dev separation

Current policy target:
- production and development should use different provider accounts or at minimum different API keys
- production secrets must never be reused in local development

Current repo state:
- this separation is not fully documented or enforced yet and should be treated as an operational requirement for the buyer

## Minimum rotation checklist for transfer

- Rotate `DATABASE_URL`
- Rotate `NEXTAUTH_SECRET` and `AUTH_SECRET`
- Rotate `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`
- Rotate `ANTHROPIC_API_KEY`
- Rotate `KIE_API_KEY`
- Rotate `APIFY_API_TOKEN`
- Rotate `ASSEMBLYAI_API_KEY`
- Rotate `GOOGLE_CLOUD_VISION_API_KEY`
- Rotate `ELEVENLABS_API_KEY`
- Rotate `FAL_API_KEY`
- Rotate `STRIPE_SECRET_KEY`
- Rotate `STRIPE_WEBHOOK_SECRET`
- Rotate `REDIS_URL` if Redis is used
- Rotate any debug/internal secrets still present

## Validation after rotation

After each rotation set, validate:

- user can sign in
- project pages load
- customer research can be queued
- ad collection can run
- script generation can run
- storyboard generation can run
- first-frame/video generation can run
- product setup uploads still work
- billing routes respond correctly if billing is enabled

## Current gap disclosure

- This runbook documents what must be rotated and how.
- The platform does not yet enforce or automate periodic rotation.
- Rotation remains an operational process to be owned by the buyer after transfer.
