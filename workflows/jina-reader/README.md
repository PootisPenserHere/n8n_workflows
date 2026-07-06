# Jina Reader Workflow

This directory contains a standalone callable n8n workflow that fetches one URL through Jina Reader and returns normalized markdown content to the caller.

## Files

| File | Purpose |
| --- | --- |
| `jina-reader-fetch-url.workflow.json` | Main callable workflow. Receives a URL, rate-limits through Redis, retries Reader HTTP errors, calls Jina Reader, and returns normalized content. |
| `test-jina-reader-fetch-url.workflow.json` | Manual test workflow. Sends a sample URL to the main workflow and returns a compact preview. |
| `README.md` | Local setup and usage notes. |

AI implementation context is kept in the repository root at `AI_CONTEXT.md`, not in this workflow directory. From this directory, the relative path is `../../AI_CONTEXT.md`.

## Main workflow

**Workflow name:** `Jina Reader - Fetch URL`

This workflow is intended to be called from other workflows using n8n's Execute Workflow / sub-workflow mechanism. It accepts one URL, applies shared Redis-backed rate limiting, retries transient Reader HTTP failures, and returns either markdown content or a normalized error response.

High-level flow:

```text
When Executed by Another Workflow
  -> Normalize Input
  -> Prepare Attempt State
  -> Increment Rate Counter
  -> Attach Rate Limit State
  -> Rate Limit Available?
      true  -> Jina Reader
                 success -> Format Reader Response
                 error   -> Handle Reader Error -> Retry Available?
                              true  -> Prepare Attempt State
                              false -> Format Error Response
      false -> Wait For Rate Limit Window -> Prepare Attempt State
```

## Required credential

Create or reselect an n8n **Redis** credential for the **Increment Rate Counter** node after import.

The workflow does not require a Jina credential while using the free/no-key Reader endpoint.

## Why Reader URL construction is string-only

Jina Reader reads a target URL by prepending the Reader host directly to the target URL:

```text
https://r.jina.ai/https://example.com/page
```

The workflow intentionally mirrors the working Brave Search + Reader workflow and builds Reader URLs like this:

```js
readerUrl: `https://r.jina.ai/${url}`
```

Do not replace this with generic `new URL(...)` parsing unless the change is tested inside n8n with all accepted input forms. The workflow only does lightweight string normalization, then directly prepends `https://r.jina.ai/`.

URL normalization rules:

1. Strip an already-prepended `https://r.jina.ai/` prefix if present.
2. Convert protocol-relative URLs such as `//example.com/page` to HTTPS.
3. Repair malformed single-slash protocols such as `https:/example.com/page`.
4. Convert bare host/path values such as `example.com/page` to HTTPS.
5. Build the Reader URL as `https://r.jina.ai/${url}`.

Accepted URL forms:

- `https://example.com/page`
- `http://example.com/page`
- `//example.com/page`
- `example.com/page`
- `https:/example.com/page`
- `https://r.jina.ai/https://example.com/page`

## Input contract

The main workflow accepts one input item with this JSON shape:

```json
{
  "url": "https://serper.dev/",
  "maxContentChars": 6000,
  "requestTimeoutMs": 60000,
  "redisRateLimitKey": "jina_reader:free:rpm",
  "rateLimitMaxRequests": 20,
  "rateLimitWindowSeconds": 60,
  "rateLimitSleepBufferSeconds": 5,
  "maxAttempts": 3
}
```

Accepted aliases:

- `url`: `targetUrl`, `sourceUrl`, `href`, `link`
- `maxContentChars`: `max_content_chars`
- `requestTimeoutMs`: `request_timeout_ms`
- `redisRateLimitKey`: `redis_rate_limit_key`, `rateLimitKey`, `rate_limit_key`
- `rateLimitMaxRequests`: `rate_limit_max_requests`, `maxRequestsPerWindow`, `max_requests_per_window`
- `rateLimitWindowSeconds`: `rate_limit_window_seconds`, `windowSeconds`, `window_seconds`
- `rateLimitSleepBufferSeconds`: `rate_limit_sleep_buffer_seconds`, `sleepBufferSeconds`, `sleep_buffer_seconds`
- `maxAttempts`: `max_attempts`, `retryMaxAttempts`, `retry_max_attempts`, `retryCount`, `retry_count`, `retries`

Defaults and limits:

| Field | Default | Limits | Notes |
| --- | ---: | ---: | --- |
| `url` | none | non-empty string | Required. |
| `maxContentChars` | `6000` | `1000` to `200000` | Truncates returned markdown. |
| `requestTimeoutMs` | `60000` | `1000` to `300000` | Timeout for each Jina Reader HTTP attempt. |
| `redisRateLimitKey` | `jina_reader:free:rpm` | non-empty string | Shared Redis counter key. |
| `rateLimitMaxRequests` | `20` | `1` to `1000` | Default matches the free/no-key Jina Reader 20 RPM limit. |
| `rateLimitWindowSeconds` | `60` | `1` to `3600` | Redis TTL reset window. |
| `rateLimitSleepBufferSeconds` | `5` | `0` to `3600` | Added to wait time after a limit hit. |
| `maxAttempts` | `3` | `1` to `20` | Total Reader HTTP attempts. First fetch is attempt 1. |

## Output contract

Successful responses use this top-level shape:

```json
{
  "status": "ok",
  "provider": "jina_reader",
  "url": "https://serper.dev/",
  "readerUrl": "https://r.jina.ai/https://serper.dev/",
  "fetched": true,
  "contentType": "markdown",
  "contentChars": 6000,
  "originalContentChars": 98351,
  "truncated": true,
  "content": "Title: ...\nURL Source: ...\n\nMarkdown Content: ...",
  "reader": {
    "status": "ok",
    "fetched": true,
    "provider": "jina_reader",
    "readerUrl": "https://r.jina.ai/https://serper.dev/"
  },
  "retry": {
    "enabled": true,
    "maxAttempts": 3,
    "currentAttempt": 1,
    "attemptsMade": 1,
    "succeeded": true,
    "succeededAttempt": 1,
    "failedAttempts": 0,
    "errors": []
  },
  "rateLimit": {
    "enabled": true,
    "provider": "redis",
    "redisKey": "jina_reader:free:rpm",
    "limit": 20,
    "windowSeconds": 60,
    "sleepBufferSeconds": 5,
    "counter": 1,
    "allowed": true,
    "hit": false,
    "remainingTtlSeconds": 60,
    "waitSeconds": 65,
    "strategy": "simple_counter_increment_before_request_reset_ttl_60s"
  },
  "request": {},
  "metadata": {
    "strategy": "single_url_jina_reader_free_endpoint_with_redis_simple_counter_rate_limit_and_retry",
    "contentKey": "content",
    "contentKeyNote": "Use top-level content as the preferred key for the markdown read from the URL.",
    "firstFetchCountsAsAttempt": true,
    "retryStrategy": "reader_http_error_retry_total_attempts_first_fetch_is_attempt_1",
    "rateLimitStrategy": "simple_counter_increment_before_request_reset_ttl_60s"
  },
  "receivedAt": "2026-07-06T00:26:54.039Z"
}
```

The top-level `content` field is the preferred field for downstream workflows and AI nodes to read. `contentPreview` only exists in the test workflow.

## Error response

If all Reader attempts fail, the workflow returns a normalized error response instead of throwing an unhandled error:

```json
{
  "status": "error",
  "provider": "jina_reader",
  "url": "https://example.invalid/",
  "readerUrl": "https://r.jina.ai/https://example.invalid/",
  "fetched": false,
  "content": null,
  "contentChars": 0,
  "originalContentChars": 0,
  "truncated": false,
  "error": {
    "message": "Jina Reader request failed",
    "name": null,
    "statusCode": 500,
    "code": null,
    "description": null,
    "responseBody": "...",
    "stack": "...",
    "rawPreview": "..."
  },
  "retry": {
    "enabled": true,
    "maxAttempts": 3,
    "attemptsMade": 3,
    "succeeded": false,
    "failedAttempts": 3,
    "shouldRetry": false,
    "errors": []
  },
  "rateLimit": {},
  "request": {},
  "metadata": {
    "strategy": "single_url_jina_reader_free_endpoint_with_redis_simple_counter_rate_limit_and_retry",
    "contentKey": "content",
    "retryStrategy": "reader_http_error_retry_total_attempts_first_fetch_is_attempt_1",
    "firstFetchCountsAsAttempt": true
  },
  "receivedAt": "2026-07-06T00:00:00.000Z"
}
```

`retry.errors[]` contains one entry per failed Reader HTTP attempt. Each entry includes the attempt number, timestamp, Reader URL, message, status code, response body if available, stack if available, and a capped `rawPreview` for debugging.

## Rate-limit behavior

- This workflow intentionally uses a simple Redis counter, not a sliding window.
- Redis key: default `jina_reader:free:rpm`.
- Limit: default `20` attempts per `60` seconds for the free/no-key Jina Reader endpoint.
- The workflow increments the Redis counter **before** each Reader fetch attempt.
- The Redis **Increment Rate Counter** node has `expire: true` and `ttl: 60`, so every attempt resets the counter key TTL to 60 seconds.
- Attempts are counted whether the later Reader request succeeds or fails.
- If the incremented counter is above the limit, the workflow does **not** call Jina Reader. It waits `remainingTtlSeconds + rateLimitSleepBufferSeconds` and then loops back to increment/check again.
- Rate-limit waits do not advance `retry.currentAttempt`, because no Reader HTTP fetch was made.
- Because the workflow resets TTL on every increment, the effective remaining TTL immediately after a limit-hit increment is treated as `rateLimitWindowSeconds`. With defaults, wait time is `60 + 5 = 65` seconds.
- A 65-second default wait is intentional because n8n does not offload waits shorter than 65 seconds to the database. This helps long backoff loops avoid keeping the process hot.
- If caller workflows may wait/retry for hours, ensure n8n workflow timeout settings and execution-data retention are configured accordingly.
- For Redis debugging, check the exact Redis instance and logical database configured in the n8n Redis credential. The key has a short TTL and may disappear quickly after execution.

## Retry behavior

- `maxAttempts` defaults to `3`.
- The first Jina Reader HTTP fetch counts as attempt `1`.
- On a Jina Reader HTTP error, the workflow captures the actual error details, appends them to `retry.errors[]`, and checks whether another attempt is available.
- If `currentAttempt < maxAttempts`, it loops back through Redis rate limiting before making the next Reader fetch.
- Each retry attempt increments Redis before the Reader HTTP request.
- If all attempts fail, the workflow returns `status: "error"`, `fetched: false`, the final `error`, and the full `retry.errors[]` history.
- Normalization errors and Redis credential/connection errors are not retried as Reader fetch attempts; they return normalized error responses immediately.

## Import checklist

1. Import `jina-reader-fetch-url.workflow.json`.
2. Open **Increment Rate Counter** and select the local Redis credential.
3. Save the main workflow.
4. Import `test-jina-reader-fetch-url.workflow.json`.
5. Open **Call Jina Reader Workflow** and select the imported main workflow.
6. Save the test workflow.
7. Run the test workflow manually.
8. Confirm the output has `status: "ok"`, `fetched: true`, a populated top-level `content`, `rateLimit.counter`, and `retry.succeededAttempt`.

## Troubleshooting

- If Jina fetches content but Redis keys are not visible in `redis-cli`, verify the Redis credential host and database. Similar Docker service names can point to different Redis instances.
- The default key expires after 60 seconds. Check it immediately after a run, or temporarily set `rateLimitWindowSeconds` higher during debugging.
- The test workflow's `contentPreview` is not the canonical content field. Use the main workflow's top-level `content` field in caller workflows.
- If an import shows stale workflow IDs or credential IDs, reselect the local workflow and credentials from the n8n UI.

## Future work

- Add an optional credentialed Jina path for higher throughput.
- Consider a more precise Redis Lua or REST implementation if exact TTL reads are needed later. The current behavior is deliberately simple and treats TTL as freshly reset after every increment.
- Consider a batch wrapper workflow if parent workflows frequently need to fetch many URLs and aggregate the results.
