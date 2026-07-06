# AI Context

This file is the single repository-level AI context for this n8n workflow collection.

Keep this file in the repository root and update it whenever workflow behavior, input/output contracts, credentials, external API assumptions, or design decisions change. Do not create workflow-specific AI context files inside workflow directories; directory READMEs should link back to this root file instead.

## Repository conventions

- Workflows are stored as exported n8n JSON files under `workflows/<domain>/`.
- Workflow directory READMEs describe local import/setup/use details.
- Cross-workflow AI context, research notes, API assumptions, and architectural decisions live only in this root `AI_CONTEXT.md`.
- Do not hard-code secrets in workflow JSON. Use n8n credentials.
- Imported workflow JSON can contain stale credential IDs or workflow IDs from another n8n instance. After import, reselect credentials and called workflows from the local n8n UI.

## Web search workflows - Brave API + Jina Reader

### Current files

- `workflows/web-search/README.md`
- `workflows/web-search/web-search-brave-api-reader.workflow.json`
- `workflows/web-search/test-web-search-brave-api-reader.workflow.json`

### Purpose

The web search workflow is a reusable callable workflow that other n8n workflows can use to send a search query and receive normalized web records for downstream AI inference.

The current implementation:

1. Receives a query from another workflow.
2. Calls Brave Web Search for candidate links.
3. Normalizes and deduplicates candidate URLs.
4. Fetches page content for a limited number of top URLs using the free Jina Reader endpoint.
5. Returns a normalized response containing Brave metadata and Reader-enriched page content.

### Sources used

- n8n Execute Sub-workflow Trigger documentation: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.executeworkflowtrigger/
  - Used to confirm callable workflows start with **Execute Sub-workflow Trigger / When Executed by Another Workflow**.
- n8n Execute Sub-workflow documentation: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.executeworkflow/
  - Used to confirm parent workflows can call reusable workflows and wait for the sub-workflow response.
- n8n HTTP Request node documentation: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/
  - Used for Brave and Jina Reader HTTP calls.
- n8n HTTP Request credentials documentation: https://docs.n8n.io/integrations/builtin/credentials/httprequest/
  - Used for the Brave `X-Subscription-Token` HTTP Header Auth credential.
- n8n rate-limit documentation: https://docs.n8n.io/integrations/builtin/rate-limits/
  - Used for the Loop Over Items + Wait approach to avoid bursting Reader requests in the Brave workflow.
- n8n Loop Over Items documentation: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.splitinbatches/
  - Used for one-URL-at-a-time Reader processing.
- Jina Reader API documentation: https://jina.ai/reader/
  - Used to confirm the free Reader endpoint is `https://r.jina.ai/`, the no-key Reader limit is 20 RPM, and URLs can be read by prepending `https://r.jina.ai/` to the target URL.
- Brave Web Search API reference: https://api-dashboard.search.brave.com/api-reference/web/search/get
  - Used to confirm `GET https://api.search.brave.com/res/v1/web/search`, the required `q` parameter, `count` limits, `freshness`, `result_filter`, and the `X-Subscription-Token` header.

### Business decisions

- The reusable workflow is named **Web Search - Brave API + Reader**.
- It is designed to be called by other workflows through **Execute Sub-workflow / Execute Workflow**.
- The companion workflow **Test - Web Search Brave API + Reader** exists only for manual testing and smoke checks.
- The current strategy is: over-retrieve from Brave, dedupe URLs, then read only the top `readTopN` URLs using Jina Reader.
- The workflow uses Brave ranking as the first-pass ordering and does not use a dedicated reranker yet.
- Reader calls are rate-controlled with **Loop Over Items** batch size 1 plus **Wait Between Reader Calls**.
- Brave API key must remain in n8n credentials, never in workflow JSON.
- Error responses should avoid returning raw request/response objects that may contain credentials or sensitive headers.

### Credential requirements

Create an n8n **HTTP Header Auth** credential for Brave.

Suggested credential display name:

```text
Brave Search API
```

Credential fields:

```text
Name:  X-Subscription-Token
Value: <your Brave Search API key>
```

After importing the workflow, open the **Brave Web Search** HTTP Request node and reselect the local Brave credential. Exported workflow JSON may contain stale credential IDs from another n8n instance.

### Input contract

The workflow accepts one input item with this JSON shape:

```json
{
  "query": "n8n execute sub-workflow trigger input data",
  "count": 10,
  "readTopN": 3,
  "readerDelaySeconds": 4,
  "maxContentChars": 6000,
  "country": "US",
  "search_lang": "en",
  "ui_lang": "en-US",
  "freshness": "",
  "safesearch": "moderate"
}
```

Accepted aliases:

- `query`: `q`, `searchQuery`
- `count`: `limit`
- `readTopN`: `read_top_n`, `readerLimit`
- `readerDelaySeconds`: `reader_delay_seconds`
- `maxContentChars`: `max_content_chars`
- `search_lang`: `searchLang`
- `ui_lang`: `uiLang`

Defaults and limits:

- `count`: default `10`, clamped from `1` to `20`.
- `readTopN`: default `3`, clamped from `0` to `5`.
- `readerDelaySeconds`: default `4`, clamped from `1` to `60`.
- `maxContentChars`: default `6000`, clamped from `1000` to `50000`.
- `country`: default `US`.
- `search_lang`: default `en`.
- `ui_lang`: default `en-US`.
- `freshness`: empty string, `pd`, `pw`, `pm`, `py`, or `YYYY-MM-DDtoYYYY-MM-DD`.
- `safesearch`: `off`, `moderate`, or `strict`; default `moderate`.

### Output contract

Successful responses use this top-level shape:

```json
{
  "status": "ok",
  "provider": "brave+jina_reader",
  "query": "n8n execute sub-workflow trigger input data",
  "candidateCount": 10,
  "recordCount": 3,
  "records": [],
  "request": {},
  "metadata": {},
  "receivedAt": "2026-06-26T23:41:37.114Z"
}
```

Each record includes Brave metadata and a `reader` object:

```json
{
  "rank": 1,
  "title": "Execute Sub-workflow | n8n Docs",
  "url": "https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.executeworkflow/",
  "description": "Search result description from Brave.",
  "age": null,
  "pageAge": null,
  "language": "en",
  "familyFriendly": true,
  "extraSnippets": [],
  "profile": null,
  "source": "brave:web",
  "readerRank": 1,
  "reader": {
    "status": "ok",
    "fetched": true,
    "provider": "jina_reader",
    "readerUrl": "https://r.jina.ai/https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.executeworkflow/",
    "contentType": "markdown",
    "contentChars": 6000,
    "originalContentChars": 12000,
    "truncated": true,
    "content": "Title: ...\nURL Source: ...\n\nMarkdown content..."
  }
}
```

Possible `reader.status` values:

- `ok`: Jina Reader returned content and the workflow attached it to the record.
- `error`: Jina Reader failed for that URL, but the workflow preserved the record and attached error details.
- `skipped`: The workflow did not fetch Reader content for the record, usually because no Reader URL was available or `readTopN` was `0`.

### Error contract

If the workflow fails before producing records, it returns a normalized error response:

```json
{
  "status": "error",
  "provider": "brave+jina_reader",
  "query": "example query",
  "candidateCount": 0,
  "recordCount": 0,
  "records": [],
  "error": {
    "message": "Search workflow failed before producing results",
    "name": null
  },
  "request": {},
  "receivedAt": "2026-06-26T23:41:37.114Z"
}
```

### Rate-limit assumptions

- Jina Reader free no-key endpoint should be treated conservatively.
- Current Brave workflow default: `readTopN: 3` and `readerDelaySeconds: 4`.
- Keep `readTopN` small when using the free endpoint.
- Prefer increasing Brave `count` first and keeping Reader enrichment between `3` and `5` URLs.

Recommended starting points:

| Use case | `count` | `readTopN` | `readerDelaySeconds` | `maxContentChars` |
| --- | ---: | ---: | ---: | ---: |
| Fast smoke test | `5` | `1` | `4` | `3000` |
| Normal AI grounding | `10` | `3` | `4` | `6000` |
| Deeper research | `20` | `5` | `4` to `8` | `10000` |

### Future work

- Add a true reranker after the Reader-enriched version is stable.
- Preferred future flow:

```text
Brave returns up to 20 candidates
  -> Normalize and dedupe URLs
  -> Rerank titles/descriptions against the query
  -> Read top 3-5 URLs with Jina Reader
  -> Optionally rerank content previews
  -> Return enriched records
```

- Consider adding a credentialed Jina path if higher Reader throughput or Jina Reranker is needed.
- Preserve the current callable workflow contract as much as possible so existing parent workflows do not break.

## Jina Reader workflow - Fetch URL

### Current files

- `workflows/jina-reader/README.md`
- `workflows/jina-reader/jina-reader-fetch-url.workflow.json`
- `workflows/jina-reader/test-jina-reader-fetch-url.workflow.json`

### Purpose

**Jina Reader - Fetch URL** is a reusable callable workflow for parent n8n workflows that already have a URL and need Reader-converted page content. It does not search the web. It accepts one URL, applies a shared Redis-backed rate limit, retries transient Reader HTTP failures, and returns normalized markdown content or a normalized error object.

### Sources used

- Jina Reader API documentation: https://jina.ai/reader/
  - Used to confirm the Reader endpoint is `https://r.jina.ai/`, URLs are read by prepending `https://r.jina.ai/` to the target URL, and the free/no-key Reader limit is 20 RPM.
- n8n Execute Sub-workflow Trigger documentation: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.executeworkflowtrigger/
  - Used to keep the workflow callable by other workflows.
- n8n Execute Sub-workflow documentation: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.executeworkflow/
  - Used to confirm parent workflows and the companion test workflow can call the reusable workflow and wait for the response.
- n8n HTTP Request node documentation: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/
  - Used for the Jina Reader HTTP call.
- n8n Redis node documentation: https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.redis/
  - Used for the Redis increment counter. The Redis node can atomically increment a key and create it if missing.
- n8n Redis node source: https://github.com/n8n-io/n8n/blob/master/packages/nodes-base/nodes/Redis/Redis.node.ts
  - Used to confirm the Redis node's increment operation can apply expiration/TTL after increment.
- n8n Wait node documentation: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.wait/
  - Used to confirm Wait can pause executions and that waits shorter than 65 seconds are not offloaded to the database.

### Business decisions

- The reusable workflow is named **Jina Reader - Fetch URL**.
- It is designed to be called by other workflows through **Execute Sub-workflow / Execute Workflow**.
- The companion workflow **Test - Jina Reader Fetch URL** exists only for manual smoke testing.
- The workflow uses the free/no-key Jina Reader endpoint. No Jina credential is required while using this mode.
- The workflow requires a Redis credential for shared rate limiting.
- The workflow accepts a single URL and returns a single normalized response.
- The top-level `content` key is the preferred output key for downstream workflows and AI nodes to read the markdown returned from the URL. `contentPreview` is only a test/debug field and should not be treated as canonical content.
- Error responses should avoid returning raw unlimited request/response objects that may contain credentials or sensitive headers. Capped debug previews are acceptable.

### Reader URL construction and URL handling

Jina Reader reads a target URL by prepending the Reader host directly to the original target URL:

```text
https://r.jina.ai/https://example.com/page
```

The workflow intentionally builds Reader URLs with lightweight string normalization followed by direct concatenation:

```js
readerUrl: `https://r.jina.ai/${url}`
```

Do not replace this with generic `new URL(...)` parsing unless the change is specifically tested inside n8n with all accepted input forms. The reliable contract for this workflow is:

1. Treat the incoming URL as a string.
2. Strip an already-prepended `https://r.jina.ai/` prefix if present, so callers can safely pass either target URLs or Reader URLs.
3. Coerce protocol-relative URLs such as `//example.com/page` to HTTPS.
4. Repair malformed single-slash protocols such as `https:/example.com/page` to `https://example.com/page`.
5. Coerce bare host/path values such as `example.com/page` to HTTPS.
6. Build the Reader URL as `https://r.jina.ai/${url}`.

Accepted URL fields are `url`, `targetUrl`, `sourceUrl`, `href`, and `link`.

Accepted URL forms:

- `https://example.com/page`
- `http://example.com/page`
- `//example.com/page`
- `example.com/page`
- `https:/example.com/page`
- `https://r.jina.ai/https://example.com/page`

### Credential requirements

Create or reselect an n8n **Redis** credential for the **Increment Rate Counter** node after importing the workflow.

The workflow does not require a Jina credential while using the free/no-key Reader endpoint.

### Input contract

The workflow accepts one input item with this JSON shape:

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
| `requestTimeoutMs` | `60000` | `1000` to `300000` | Timeout for each Reader HTTP attempt. |
| `redisRateLimitKey` | `jina_reader:free:rpm` | non-empty string | Shared Redis counter key. |
| `rateLimitMaxRequests` | `20` | `1` to `1000` | Default matches the free/no-key Reader 20 RPM limit. |
| `rateLimitWindowSeconds` | `60` | `1` to `3600` | Redis TTL reset window. |
| `rateLimitSleepBufferSeconds` | `5` | `0` to `3600` | Added to the wait time after a limit hit. |
| `maxAttempts` | `3` | `1` to `20` | Total Reader HTTP fetch attempts. The first fetch is attempt 1. |

### Output contract

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

Downstream workflows should read the fetched markdown from top-level `content`. The `reader` object is status metadata, not the canonical content container.

### Error contract

Normalization errors, Redis errors, and exhausted Reader retries return normalized error responses instead of unhandled errors.

If all Reader HTTP attempts fail, the response uses this top-level shape:

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

`retry.errors[]` contains one entry per failed Reader HTTP attempt. Each entry should include the attempt number, timestamp, Reader URL, message, status code, response body if available, stack if available, and a capped `rawPreview` for debugging.

### Rate-limit behavior

- The workflow intentionally uses a simple Redis counter, not a sliding window.
- Redis key: default `jina_reader:free:rpm`.
- Limit: default `20` attempts per `60` seconds for the free/no-key Jina Reader endpoint.
- The workflow increments the Redis counter **before** each Reader HTTP fetch attempt.
- The Redis **Increment Rate Counter** node has `expire: true` and `ttl: 60`, so every attempt resets the counter key TTL to 60 seconds.
- Attempts are counted whether the later Reader request succeeds or fails.
- If the incremented counter is above the limit, the workflow does **not** call Jina Reader. It waits `remainingTtlSeconds + rateLimitSleepBufferSeconds` and then loops back to increment/check again.
- Rate-limit waits do not advance `retry.currentAttempt`, because no Reader HTTP fetch was made.
- Because this workflow resets TTL on every increment, the effective remaining TTL immediately after a limit-hit increment is treated as `rateLimitWindowSeconds`. With defaults, wait time is `60 + 5 = 65` seconds.
- A 65-second default wait is intentional because n8n does not offload waits shorter than 65 seconds to the database. This helps long backoff loops avoid keeping the process hot.
- If caller workflows may wait/retry for hours, ensure n8n workflow timeout settings and execution-data retention are configured accordingly.
- For Redis debugging, check the exact Redis instance and logical database configured in the n8n Redis credential. The rate-limit key has a short TTL and may disappear quickly after execution.

### Retry behavior

- `maxAttempts` defaults to `3` and means total Reader HTTP fetch attempts, not additional retries.
- The first Jina Reader HTTP fetch counts as attempt `1`.
- On a Jina Reader HTTP error, the workflow captures the actual error details, appends them to `retry.errors[]`, and checks whether another attempt is available.
- If `currentAttempt < maxAttempts`, the workflow loops back through Redis rate limiting before making the next Reader fetch.
- Each retry attempt increments Redis before the Reader HTTP request.
- Rate-limit waits do not advance the retry counter because no Reader HTTP request was made.
- If all attempts fail, the workflow returns `status: "error"`, `fetched: false`, the final top-level `error`, and the full `retry.errors[]` history so caller workflows can detect and debug failure.
- Normalization errors and Redis credential/connection errors are not retried as Reader HTTP attempts; they return normalized error responses immediately.

### Operational notes

- After import, reselect the Redis credential in **Increment Rate Counter**.
- After importing the test workflow, open **Call Jina Reader Workflow** and select the imported **Jina Reader - Fetch URL** workflow from the local n8n dropdown.
- The test workflow should verify `status: "ok"`, `fetched: true`, non-empty top-level `content`, `rateLimit.counter`, and `retry.succeededAttempt`.
- Do not hard-code Redis passwords, Jina tokens, or other secrets in workflow JSON.

### Future work

- Add an optional credentialed Jina path for higher throughput.
- Consider a more precise Redis Lua or REST implementation if exact TTL reads are needed later. The current behavior is deliberately simple and treats TTL as freshly reset after every increment.
- Consider a batch wrapper workflow if parent workflows frequently need to fetch many URLs and aggregate the results.
