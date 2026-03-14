# Reddit Scraper Service

Lightweight Express service that provides the Reddit scraping API for the Victora research pipeline. Uses Reddit's public JSON API — no API key required.

## Setup

```bash
npm install
npm start
```

Runs on port `5001` by default.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `5001` | Port to listen on |
| `REDDIT_USER_AGENT` | `victora-research-bot/1.0` | User agent string for Reddit requests |

## API

### POST /scrape

Accepts the same request shape the platform expects:

```json
{
  "query": "muscle growth supplements",
  "search_type": "subreddit",
  "subreddit": "bodybuilding",
  "max_posts": 50,
  "time_range": "month",
  "scrape_comments": true,
  "max_comments_per_post": 50
}
```

- `search_type`: `"subreddit"` targets a specific subreddit, `"sitewide"` searches all of Reddit
- `subreddit`: required when `search_type` is `"subreddit"`
- `time_range`: `"week"`, `"month"`, `"year"`, or `"all"`

### GET /health

Returns `{ "status": "ok" }`.

## Deployment

For production, deploy this service on the same server as your worker or any VPS. Then set:

```
REDDIT_SCRAPER_URL=http://your-server-ip:5001
```

in your `.env`.

### Run with PM2

```bash
npm install -g pm2
pm2 start server.js --name reddit-scraper
pm2 save
pm2 startup
```
