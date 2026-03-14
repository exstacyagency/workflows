const express = require("express");
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 5001;
const USER_AGENT = process.env.REDDIT_USER_AGENT || "victora-research-bot/1.0";

// Reddit's public JSON API — no auth required for public content
async function redditFetch(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
    },
  });
  if (!res.ok) {
    throw new Error(`Reddit API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

function buildSearchUrl({ query, subreddit, time_range = "month", max_posts = 50 }) {
  const base = subreddit
    ? `https://www.reddit.com/r/${subreddit}/search.json`
    : `https://www.reddit.com/search.json`;

  const params = new URLSearchParams({
    q: query,
    sort: "relevance",
    t: time_range,
    limit: Math.min(max_posts, 100).toString(),
    type: "link",
  });

  if (subreddit) {
    params.set("restrict_sr", "1");
  }

  return `${base}?${params.toString()}`;
}

function mapPost(child) {
  const d = child.data;
  return {
    id: d.id,
    title: d.title,
    author: d.author,
    subreddit: d.subreddit,
    upvotes: d.ups,
    score: d.score,
    num_comments: d.num_comments,
    url: d.url,
    selftext: d.selftext,
    created_utc: d.created_utc,
    permalink: `https://www.reddit.com${d.permalink}`,
    is_video: d.is_video,
    thumbnail: d.thumbnail,
  };
}

function mapComment(child, postId) {
  const d = child.data;
  if (!d || !d.id || d.body === "[deleted]" || d.body === "[removed]") return null;
  return {
    id: d.id,
    post_id: postId,
    author: d.author,
    body: d.body,
    upvotes: d.ups ?? 0,
    depth: d.depth ?? 0,
    parent_id: d.parent_id ?? null,
    created_utc: d.created_utc,
  };
}

function flattenComments(listing, postId, maxComments = 50) {
  const comments = [];
  function traverse(children) {
    if (!Array.isArray(children)) return;
    for (const child of children) {
      if (comments.length >= maxComments) break;
      if (child.kind === "t1") {
        const mapped = mapComment(child, postId);
        if (mapped) comments.push(mapped);
        if (child.data?.replies?.data?.children) {
          traverse(child.data.replies.data.children);
        }
      }
    }
  }
  traverse(listing);
  return comments;
}

async function fetchComments(postId, subreddit, maxComments) {
  try {
    const url = `https://www.reddit.com/r/${subreddit}/comments/${postId}.json?limit=${maxComments}&depth=3`;
    const data = await redditFetch(url);
    if (!Array.isArray(data) || data.length < 2) return [];
    const commentListing = data[1]?.data?.children ?? [];
    return flattenComments(commentListing, postId, maxComments);
  } catch (err) {
    console.error(`[Comments] Failed for post ${postId}:`, err.message);
    return [];
  }
}

app.post("/scrape", async (req, res) => {
  const {
    query,
    search_type = "sitewide",
    subreddit,
    max_posts = 50,
    time_range = "month",
    scrape_comments = true,
    max_comments_per_post = 50,
  } = req.body;

  if (!query) {
    return res.status(400).json({ error: "query is required" });
  }

  console.log(`[Scrape] query="${query}" search_type=${search_type} subreddit=${subreddit || "all"} max_posts=${max_posts}`);

  try {
    const targetSubreddit = search_type === "subreddit" && subreddit ? subreddit : null;
    const searchUrl = buildSearchUrl({ query, subreddit: targetSubreddit, time_range, max_posts });

    console.log(`[Scrape] Fetching: ${searchUrl}`);
    const data = await redditFetch(searchUrl);

    const children = data?.data?.children ?? [];
    const posts = children
      .filter((c) => c.kind === "t3")
      .map(mapPost)
      .filter((p) => p.id && p.title);

    console.log(`[Scrape] Found ${posts.length} posts`);

    let allComments = [];

    if (scrape_comments && posts.length > 0) {
      // Fetch comments concurrently with a concurrency limit of 5
      const limit = 5;
      for (let i = 0; i < posts.length; i += limit) {
        const batch = posts.slice(i, i + limit);
        const results = await Promise.all(
          batch.map((post) =>
            fetchComments(post.id, post.subreddit || "all", max_comments_per_post)
          )
        );
        allComments.push(...results.flat());
      }
      console.log(`[Scrape] Fetched ${allComments.length} comments`);
    }

    return res.json({
      posts,
      comments: allComments,
      meta: {
        subreddit: targetSubreddit || "sitewide",
        total_posts: posts.length,
        total_comments: allComments.length,
        scraped_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error("[Scrape] Error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.listen(PORT, () => {
  console.log(`Reddit scraper running on port ${PORT}`);
});
