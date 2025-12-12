## Dev Test Mode

For local testing only, you can set the environment variable `FF_DEV_TEST_MODE=true` in your `.env`.

When this flag is enabled the backend skips rate limits, usage quotas, and concurrency guards so you can iterate quickly.  
**Never enable this flag in production** – it disables key safety controls.
