# Video Images Backend Notes

## Provider behavior
- Nano Banana Pro is **single-image per task**.
- Product behavior is **first frame + last frame only**:
  - Two KIE tasks per run (frameIndex min/max)
  - Aggregated into one Job row (type: VIDEO_IMAGE_GENERATION)
  - Persisted to StoryboardScene.firstFrameUrl / lastFrameUrl

## Dev spend safety
- KIE_LIVE_MODE=0 blocks spend at the orchestrator level.
- KIE_REQUIRE_SPEND_CONFIRMATION=1 requires an explicit header on /start:
  - Header: x-kie-spend-confirm: 1
  - This prevents accidental UI/console calls from burning credits.

## Force rerun
- By default, idempotency prevents repeated spends for the same storyboard/provider/force flag.
- To intentionally rerun and spend again, send a unique runNonce:
  - runNonce: Date.now().toString()

## Environment variables
- KIE_API_BASE_URL, KIE_API_KEY
- KIE_CREATE_PATH, KIE_STATUS_PATH
- VIDEO_IMAGE_PROVIDER_ID
- KIE_LIVE_MODE (0 blocks spend)
- VIDEO_IMAGES_STATUS_CONCURRENCY

## API
- POST /api/jobs/video-images/start
  - returns: { taskGroupId, idempotencyKey, tasks[] }
- POST /api/jobs/video-images/status
  - input: { taskGroupId } OR { idempotencyKey } OR { storyboardId }
  - returns: { status, images[] }
