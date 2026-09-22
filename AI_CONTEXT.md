# AI Context

This file is the single repository-level AI context for this n8n workflow collection.

Keep this file in the repository root and update it whenever workflow behavior, input/output contracts, credentials, external API assumptions, or design decisions change. Do not create workflow-specific AI context files inside workflow directories; directory READMEs should link back to this root file instead.

## Repository conventions

- Workflows are stored as exported n8n JSON files under `workflows/<domain>/`.
- Workflow directory READMEs describe local import/setup/use details.
- Cross-workflow AI context, research notes, API assumptions, and architectural decisions live only in this root `AI_CONTEXT.md`.
- Do not hard-code secrets in workflow JSON. Use n8n credentials.
- Imported workflow JSON can contain stale credential IDs or workflow IDs from another n8n instance. After import, reselect credentials and called workflows from the local n8n UI.

## Web search workflows - Brave API + Jina Reader Workflow

### Current files

- `workflows/web-search/README.md`
- `workflows/web-search/web-search-brave-api-reader.workflow.json`
- `workflows/web-search/test-web-search-brave-api-reader.workflow.json`

### Purpose

The web search workflow is a reusable callable workflow that other n8n workflows can use to send a Brave search query and receive normalized web records with Reader-enriched page content.

The current implementation:

1. Receives a query from another workflow.
2. Calls Brave Web Search for candidate links.
3. Normalizes and deduplicates candidate URLs.
4. Calls the standalone **Jina Reader - Fetch URL** workflow once for every unique Brave result URL.
5. Returns Brave metadata plus Reader content and Reader diagnostics per record.

The Brave workflow no longer calls the Jina Reader HTTP endpoint directly. Reader rate limiting, Redis sleeps, retry attempts, Reader URL normalization, and Reader error normalization all live in the standalone Jina Reader workflow.

### Sources used

- n8n Execute Sub-workflow Trigger documentation: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.executeworkflowtrigger/
  - Used to confirm the callable workflow starts with **Execute Sub-workflow Trigger / When Executed by Another Workflow**.
- n8n Execute Sub-workflow documentation: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.executeworkflow/
  - Used to confirm parent workflows can call reusable workflows and wait for sub-workflow responses.
- n8n HTTP Request node documentation: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/
  - Used for the Brave Web Search HTTP call.
- n8n HTTP Request credentials documentation: https://docs.n8n.io/integrations/builtin/credentials/httprequest/
  - Used for the Brave `X-Subscription-Token` HTTP Header Auth credential.
- Jina Reader API documentation: https://jina.ai/reader/
  - Used by the standalone Reader workflow to confirm the free Reader endpoint is `https://r.jina.ai/`, URLs can be read by prepending `https://r.jina.ai/`, and the no-key Reader API rate limit is currently 20 RPM.
- Brave Web Search API reference: https://api-dashboard.search.brave.com/api-reference/web/search/get
  - Used to confirm `GET https://api.search.brave.com/res/v1/web/search`, the required `q` parameter, `count` limits, `freshness`, `result_filter`, and the `X-Subscription-Token` header.

### Business decisions

- The current reusable workflow is named **Web Search - Brave API + Jina Reader Workflow**.
- It is designed to be called by other workflows through **Execute Sub-workflow / Execute Workflow**.
- The companion workflow **Test - Web Search Brave API + Jina Reader Workflow** exists only for manual testing and smoke checks.
- The workflow searches with Brave and delegates all content fetching to **Jina Reader - Fetch URL**.
- The old Brave-internal Reader HTTP call, `readTopN`, and `readerDelaySeconds` behavior are removed from the active contract.
- The workflow now fetches content for **all unique Brave candidates** returned by `count`, because the standalone Reader workflow handles Redis rate limiting and sleep/backoff internally.
- Brave API key must remain in n8n credentials, never in workflow JSON.
- The Brave workflow must be configured after import by reselecting both the Brave credential and the imported **Jina Reader - Fetch URL** sub-workflow.
- Error responses should avoid returning raw request/response objects that may contain credentials or sensitive headers.

### Credential and workflow requirements

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

Also import and configure **Jina Reader - Fetch URL** before using the Brave workflow. The standalone Reader workflow owns the Redis credential and free Reader rate-limit behavior.

After importing the Brave workflow:

1. Open **Brave Web Search** and reselect the local Brave credential.
2. Open **Call Jina Reader Workflow** and select the imported **Jina Reader - Fetch URL** workflow.

### Input contract

The main workflow accepts one input item with this JSON shape:

```json
{
  "query": "n8n execute sub-workflow trigger input data",
  "count": 10,
  "maxContentChars": 6000,
  "requestTimeoutMs": 60000,
  "redisRateLimitKey": "jina_reader:free:rpm",
  "rateLimitMaxRequests": 20,
  "rateLimitWindowSeconds": 60,
  "rateLimitSleepBufferSeconds": 5,
  "maxAttempts": 3,
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
- `maxContentChars`: `max_content_chars`
- `requestTimeoutMs`: `request_timeout_ms`
- `redisRateLimitKey`: `redis_rate_limit_key`
- `rateLimitMaxRequests`: `rate_limit_max_requests`
- `rateLimitWindowSeconds`: `rate_limit_window_seconds`
- `rateLimitSleepBufferSeconds`: `rate_limit_sleep_buffer_seconds`
- `maxAttempts`: `max_attempts`, `retryMaxAttempts`, `retry_max_attempts`, `retryCount`, `retry_count`, `retries`
- `search_lang`: `searchLang`
- `ui_lang`: `uiLang`

Defaults and limits:

- `query`: required non-empty string.
- `count`: default `10`, clamped from `1` to `20`.
- `maxContentChars`: default `6000`, clamped from `1000` to `200000`; passed to the Reader sub-workflow.
- `requestTimeoutMs`: default `60000`, clamped from `1000` to `300000`; passed to the Reader sub-workflow.
- `redisRateLimitKey`: default `jina_reader:free:rpm`; passed to the Reader sub-workflow.
- `rateLimitMaxRequests`: default `20`, clamped from `1` to `1000`; passed to the Reader sub-workflow.
- `rateLimitWindowSeconds`: default `60`, clamped from `1` to `3600`; passed to the Reader sub-workflow.
- `rateLimitSleepBufferSeconds`: default `5`, clamped from `0` to `3600`; passed to the Reader sub-workflow.
- `maxAttempts`: default `3`, clamped from `1` to `20`; total Reader HTTP attempts per URL.
- `country`: default `US`.
- `search_lang`: default `en`.
- `ui_lang`: default `en-US`.
- `freshness`: empty string, `pd`, `pw`, `pm`, `py`, or `YYYY-MM-DDtoYYYY-MM-DD`.
- `safesearch`: `off`, `moderate`, or `strict`; default `moderate`.

### Output contract

Successful or partially successful responses use this top-level shape:

```json
{
  "status": "ok",
  "provider": "brave+jina_reader_workflow",
  "query": "n8n execute sub-workflow trigger input data",
  "candidateCount": 10,
  "recordCount": 10,
  "records": [],
  "request": {},
  "metadata": {},
  "receivedAt": "2026-07-06T00:00:00.000Z"
}
```

Possible top-level statuses:

- `ok`: Brave succeeded and every Reader sub-workflow response succeeded.
- `partial_error`: Brave succeeded, but at least one Reader sub-workflow response returned `status: "error"`.
- `error`: Brave failed before records were produced, or every Reader sub-workflow response failed. When Brave succeeded but all Reader calls failed, records are still returned with per-record Reader errors.

Each record includes Brave metadata plus Reader content and diagnostics:

```json
{
  "rank": 1,
  "title": "Example result",
  "url": "https://example.com/article",
  "description": "Search result description from Brave.",
  "source": "brave:web",
  "content": "Title: ...
URL Source: ...

Markdown Content: ...",
  "reader": {
    "status": "ok",
    "fetched": true,
    "provider": "jina_reader",
    "readerUrl": "https://r.jina.ai/https://example.com/article",
    "contentType": "markdown",
    "contentChars": 6000,
    "originalContentChars": 12000,
    "truncated": true,
    "content": "Title: ...
URL Source: ...

Markdown Content: ...",
    "error": null,
    "retry": {},
    "rateLimit": {}
  }
}
```

For downstream workflows, prefer `records[].content`. `records[].reader.content` is retained for compatibility with the previous Brave output shape.

### Error behavior

- Search-level failures return a normalized top-level `status: "error"`, no records, and an `error` object.
- Reader-level failures are preserved per record in `record.reader.error` and summarized in `metadata.readerStats`, `metadata.readerFailureCount`, and `metadata.failedReaderRecords`.
- The standalone Reader workflow's actual Reader error and retry details are preserved under `record.reader.retry`.

### Future work

- Add a true reranker after the Reader-enriched all-candidates version is stable.
- Preferred future flow:

```text
Brave returns up to 20 candidates
  -> Normalize and dedupe URLs
  -> Read all candidate URLs with Jina Reader callable workflow
  -> Rerank titles/descriptions/content against the query
  -> Return enriched records
```

- Consider adding a credentialed Jina path in the standalone Reader workflow if higher Reader throughput is needed.
- Preserve the callable workflow contract as much as possible so existing parent workflows do not break.

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

## Calendar notifications - Nextcloud + ntfy

Checkpoint: **2026-09-22**. The workflow exports listed below are the canonical cutoff versions; intermediate `_v1` / `_v2` / `_v3` / `_v4` development artifacts are not repository files.

### Current files

- `workflows/calendar-notifications/README.md`
- `workflows/calendar-notifications/Calendar Notifications - Discover Nextcloud Calendars.json`
- `workflows/calendar-notifications/Calendar Notifications - Scan Upcoming Events & Send Notifications.json`

### Current architecture

Calendar notifications use two n8n workflows:

1. **Calendar Notifications - Discover Nextcloud Calendars**
   - Default schedule: every 15 minutes (`*/15 * * * *`).
   - Reads all calendar resources for the configured Nextcloud user.
   - Distinguishes normal Nextcloud CalDAV calendars from externally subscribed ICS calendars.
   - Writes a persistent last-known-good calendar-source registry to Redis.
2. **Calendar Notifications - Scan Upcoming Events & Send Notifications**
   - Default schedule: every minute (`* * * * *`).
   - Reads the cached calendar-source registry instead of rediscovering calendars every minute.
   - Fetches a bounded two-local-day event horizon: **today + tomorrow in `TIMEZONE`**.
   - Reconciles normalized event keys, day snapshots, reminder buckets, changes, and deletions into Redis.
   - Sends due 30/10/1-minute reminders through ntfy.
   - Sends `event_changed` and `event_deleted`/cancelled notices through ntfy.
   - At/after 21:00 in `TIMEZONE`, sends one digest containing all cached meetings for the following local day.
   - Uses Redis permanent sent markers plus short atomic delivery claims to suppress duplicate delivery across retries and overlapping workflow executions.

The schedule trigger is intentionally the place where users change polling frequency. Do not hide polling frequency inside code.

### Configuration keys

Read service configuration from `public.key_value_store` through the existing `automation-db` PostgreSQL credential. Do not hard-code service secrets in workflow JSON.

Nextcloud/runtime keys:

- `NEXCLOUD_BASE_URL`
- `NEXCLOUD_CALENDAR_USER`
- `NEXCLOUD_CALENDAR_PASSWORD`
- `TIMEZONE`

Current deployment decision: keep `NEXCLOUD_BASE_URL` pointed at the public Nextcloud URL:

```text
https://cloud.idle.laziness.rocks
```

This public URL is currently confirmed working from the n8n workflows and should remain the configured value unless the deployment decision changes later. Do not switch it back to a Docker-internal hostname unless intentionally revisiting connectivity/routing.

Redis keys:

- `REDIS_HOST`
- `REDIS_PORT`
- `REDIS_PASSWORD`
- `REDIS_DATABASE`

The repository already has an n8n Redis credential named `Redis - shared`. Calendar workflows use that credential for Redis operations; keep it aligned with the Redis values stored in `public.key_value_store`.

ntfy keys:

- `NOTIFICATIONS_USER`
- `NOTIFICATIONS_PASSWORD`
- `NOTIFICATIONS_BASE_URL`
- `NOTIFICATIONS_CALENDAR_CHANNEL_TOPIC`

The scanner publishes to `NOTIFICATIONS_BASE_URL` using ntfy's JSON publish body with `NOTIFICATIONS_CALENDAR_CHANNEL_TOPIC` as `topic` and HTTP Basic authentication from the configured notification user/password.

### Calendar discovery contract

Calendar discovery must not assume that `NEXCLOUD_CALENDAR_USER` is identical to the internal Nextcloud UID. Use authenticated DAV `current-user-principal`, then CalDAV `calendar-home-set`, then list the calendar home with `Depth: 1`.

The calendar listing asks for display name, resource type, supported calendar components, read-only state, and the CalendarServer `source` property.

Nextcloud represents calendar subscriptions with:

```text
{http://calendarserver.org/ns/}source
```

Use the presence of this property to classify a calendar as an external subscription. Do not infer subscriptions from calendar names.

Normalized cached calendar records use these modes:

- Normal Nextcloud calendar:
  - `kind: "nextcloud_caldav"`
  - `caldavUrl`: DAV collection URL used by the event scanner for bounded `REPORT` queries
  - `icsUrl`: the calendar DAV URL with `?export`, retained as a source/reference URL
  - `fetchAuth: "nextcloud_basic"`
- External ICS subscription:
  - `kind: "subscription_ics"`
  - `subscriptionSourceUrl`: the original source URL exposed by Nextcloud
  - `icsUrl`: the same external source URL, with `webcal://` normalized to `http://` and `webcals://` normalized to `https://`
  - `fetchAuth: "none"`

This split is deliberate: external subscribed calendars such as Google secret ICS subscriptions must be fetched from their original ICS URL rather than relying on Nextcloud's cached subscription representation.

The normalized source list is cached as JSON in Redis:

```text
calendar-notifier:calendar-sources:v1
```

Durability: **no Redis TTL**. `calendar-notifier:calendar-sources:v1` is a persistent last-known-good source registry. The discovery workflow refreshes it every 15 minutes by default. A missing registry (for example after a Redis flush or before the first discovery run) is treated as a safe scanner skip: no event/reminder keys are deleted and no change/deletion notices are generated.

### Upcoming-event scan contract

Default scan cadence: every minute.

The scanner now uses this bounded local window:

```text
comparison/reconciliation: local midnight today -> local midnight after tomorrow
reminder scheduling:       now -> local midnight after tomorrow
```

The extra local day is intentional. It supports the 21:00 next-day digest and allows reminder buckets for meetings shortly after midnight tomorrow to exist before midnight today.

For normal Nextcloud calendars, use a CalDAV `REPORT calendar-query` with a `VEVENT` `time-range` bounded to the two-day horizon. For `subscription_ics` calendars, fetch the external ICS source and filter/expand locally to the same horizon.

A calendar fetch failure must not be interpreted as event deletion. State is partitioned per calendar:

- successful scan: the new per-calendar snapshot is authoritative; stale owned keys are deleted;
- temporary fetch/parse failure for a calendar still present in the discovery cache: preserve that calendar's previous Redis keys and mark its scan state `stale_preserved`;
- calendar removed from the discovery cache: delete the keys previously owned by that calendar.

This prevents a transient Nextcloud/Google fetch error from causing a mass deletion of reminders.

The scanner stores hashes of Redis values in its scan state and only rewrites changed/new scheduling keys. Scan-state schema v2 stores lightweight per-calendar `eventSnapshots` for the active two-day comparison horizon.

Change/deletion detection only runs after a **successful** fetch for that calendar. A failed fetch preserves the previous snapshot and must never create deletion/change notices. Naturally elapsed events are not treated as deletions. Common reschedules where an occurrence identity changes are paired by UID when the match is unambiguous inside the bounded horizon.

The authoritative scan-state write is deliberately delayed until after change/deletion notification delivery is confirmed. If a change/deletion ntfy send fails, or this execution loses the atomic delivery claim to an overlapping execution, this execution does **not** advance the scan state. That lets the same transition retry safely on a later run.

### Redis event/reminder schema

Default reminder offsets:

- 30 minutes before
- 10 minutes before
- 1 minute before

Current Redis keys:

```text
calendar-notifier:event:v1:<calendarId>:<occurrenceId>
calendar-notifier:events:day:v1:<YYYY-MM-DD>:<calendarId>
calendar-notifier:reminders:v1:<offsetMinutes>:<UTC-minute>:<calendarId>
calendar-notifier:scan-state:v1:<YYYY-MM-DD>
calendar-notifier:message:v1:<calendarId>:<messageId>

calendar-notifier:sent:v1:reminder:<offsetMinutes>:<UTC-minute>:<eventKey>
calendar-notifier:sent:v1:change:<messageId>
calendar-notifier:sent:v1:digest:<YYYY-MM-DD>

calendar-notifier:claim:v1:<same suffix as sent marker>
```

`calendarId` is a stable hash of the calendar source identity. Event occurrence keys are derived from calendar + UID + recurrence identity so recurring instances do not collide.

Reminder buckets use the UTC minute at or immediately after the exact reminder trigger time (`ceil` to the next minute). This prevents a reminder from being sent early when an event DTSTART includes seconds. Each bucket contains one or more entries with the referenced `eventKey`, event revision hash, offset, exact scheduled time, scheduled minute, title, calendar name, start time, all-day state, and normalized meeting link.

The delivery phase reads the current and previous few due-minute buckets. Current catch-up window: **5 minutes**. It still checks the exact `scheduledForUtc` so future reminders from the same minute bucket are not sent early.

Event/day/reminder scheduling keys have bounded TTLs long enough to survive through the active two-day horizon plus several hours. Permanent notification sent markers currently live for **14 days**.

### Notification idempotency and overlap safety

Before publishing a candidate notification, the scanner first checks its permanent `calendar-notifier:sent:v1:*` marker. If no permanent marker exists, it atomically increments a short claim key using the n8n Redis node's `INCR` operation.

Claim behavior:

- claim result `1`: this execution owns delivery and may call ntfy;
- claim result `>1`: another overlapping execution already owns delivery, so this execution does not send;
- claim TTL: **120 seconds**;
- successful ntfy delivery: write the permanent 14-day sent marker;
- failed ntfy delivery after winning the claim: delete the claim immediately so the next minute can retry;
- workflow crash after winning a claim: the claim expires automatically after 120 seconds.

For change/deletion notifications, losing a claim is treated as "delivery not yet confirmed" for scan-state purposes. The losing execution therefore does not advance authoritative scan state. The winning execution may advance it after successful delivery; if the winner crashes, a later execution can retry after the short claim expires.

### Event-change messages

Current message types:

- `event_changed`: emitted when a previously known upcoming occurrence changes in a user-relevant field;
- `event_deleted`: emitted when a previously known future occurrence is missing after a successful authoritative fetch. Explicit ICS/CalDAV `STATUS:CANCELLED` records use the same message type with `reason: "cancelled"`; otherwise the reason is `missing_after_successful_scan`.

Meaningful change fields are title, start time, end time, location, meeting URL/type, and all-day state. Description/body churn is intentionally not considered by itself to avoid noisy provider-generated updates; meeting-link changes embedded in description are still detected through normalized `meetingUrl`.

Each transition is also staged as an independent Redis message record under `calendar-notifier:message:v1:<calendarId>:<messageId>` with a 48-hour TTL. Message IDs are derived from the transition contents, so retrying the same comparison regenerates the same message/sent-marker identity.

ntfy formatting:

- `event_changed`: title `Meeting changed: <event>` and a body containing calendar, local time, changed fields, and join link when available;
- `event_deleted`: title `Meeting deleted: <event>` or `Meeting cancelled: <event>` for explicit cancellations;
- meeting link is also used as ntfy `click` target when present.

### Reminder delivery

Reminder notifications are generated from Redis reminder buckets, not by re-scanning the in-memory event list during the delivery phase.

For each due entry the sender:

1. derives the per-event/per-offset permanent sent key;
2. skips entries whose permanent sent marker already exists;
3. acquires the short atomic Redis claim;
4. sends through ntfy only when the claim result is `1`;
5. writes the permanent sent marker only after a successful ntfy response.

Reminder body includes local event time, calendar name, and the meeting link when available. The meeting link is also set as ntfy's `click` target.

### Daily next-day digest

The scanner maintains per-calendar day snapshots for both today and tomorrow:

```text
calendar-notifier:events:day:v1:<YYYY-MM-DD>:<calendarId>
```

At/after **21:00 in `TIMEZONE`**, if the target-date marker does not exist, the sender reads tomorrow's cached snapshot for every known calendar, merges and sorts all events by start time, and sends one ntfy digest.

Digest marker:

```text
calendar-notifier:sent:v1:digest:<tomorrow YYYY-MM-DD>
```

The marker is keyed by the **day being summarized**, not the day on which the message was sent. This guarantees one digest per target day across retries. If the workflow is temporarily down at exactly 21:00 but resumes later the same evening, `dueNow` remains true and the missing digest can still be sent before midnight.

If a calendar's tomorrow snapshot is unavailable, the digest includes a warning naming that calendar rather than silently pretending the calendar had no meetings. Successfully cached stale snapshots from a temporarily failing calendar remain available because failed calendar scans preserve prior Redis state.

Digest entries include the local start time (or `All day`), event title, calendar name, and meeting link when present. A no-meeting day still produces a digest saying that no meetings are scheduled.

### Event normalization and time zones

The configured `TIMEZONE` is the notification/output time zone. Event time zones from ICS/CalDAV data must be respected first, then converted to `TIMEZONE` for scheduling and rendering. Do not assume event timestamps are already in the configured zone.

The scanner supports UTC timestamps, floating/local ICS timestamps, IANA TZIDs, and a mapping for common Microsoft Windows time-zone IDs. `X-WR-TIMEZONE` is used as a calendar-level fallback where available; otherwise floating timestamps fall back to configured `TIMEZONE`.

Recurring event handling covers the common meeting recurrence families (`DAILY`, `WEEKLY`, `MONTHLY`, `YEARLY`, plus bounded `HOURLY`/`MINUTELY`), along with `RRULE`, `RDATE`, `EXDATE`, `RECURRENCE-ID`, cancelled overrides, `COUNT`, and `UNTIL`. Recurrence expansion is intentionally bounded and protected by an iteration limit.

### Meeting-link extraction

Meeting notifications should include a join link whenever one can be found. The two primary meeting families are:

- Google Calendar / Google Meet
- Microsoft Teams

The event scanner searches URL-bearing event fields including `URL`, `LOCATION`, `DESCRIPTION`, and vendor/conference properties. It recognizes common Google Meet URLs (`meet.google.com`, `g.co/meet`) and Microsoft Teams meeting URLs (`teams.microsoft.com/l/meetup-join`, `teams.microsoft.com/meet`, `teams.live.com/meet`).

The chosen link is stored on the normalized event as:

```text
meetingUrl
meetingType
```

ntfy formatting consumes these normalized fields rather than rediscovering the link.

### Current implementation boundary

Implemented:

- calendar discovery and persistent source caching;
- bounded two-day upcoming event scan;
- CalDAV `REPORT` for normal Nextcloud calendars;
- direct external ICS fetch for subscriptions;
- recurrence/time-zone normalization;
- Google Meet / Microsoft Teams URL extraction;
- Redis event keys, per-day snapshots, reminder buckets, stale-key deletion, and per-calendar failure preservation;
- `event_changed` / `event_deleted` detection;
- ntfy reminder/change/deletion delivery;
- Redis sent markers and atomic short delivery claims;
- 21:00 next-day digest with per-target-day sent marker;
- midnight-boundary reminder support through the two-day scan horizon.

Not currently split into a separate sender workflow: the every-minute scanner both refreshes Redis scheduling state and performs the delivery phase. This is an accepted implementation variation from the original idea where the first workflow would fetch calendars/events and a second workflow would be a purely mindless sender.

### Validation notes

The current scanner export has been statically syntax-checked and simulated with:

- one current-day Google Meet event and one next-day Microsoft Teams event;
- 30-minute due reminder delivery;
- 21:00 next-day digest aggregation;
- permanent sent-marker suppression on a second delivery pass;
- overlapping delivery claims where the first execution gets claim `1` and a second gets `2` and does not send;
- change notification formatting;
- failed change ntfy delivery preventing authoritative scan-state advancement.

### Research / compatibility notes

- Nextcloud DAV base/auth behavior: https://docs.nextcloud.com/server/latest/developer_manual/client_apis/WebDAV/basic.html
- Nextcloud current CalDAV backend exposes subscription `source` and stores calendar subscriptions separately: https://github.com/nextcloud/server/blob/master/apps/dav/lib/CalDAV/CalDavBackend.php
- Nextcloud calendar resources classify a resource as a subscription when the CalendarServer `source` property is present: https://github.com/nextcloud/server/blob/master/apps/dav/lib/CalDAV/Calendar.php
- Nextcloud calendar ICS exports use the calendar DAV URL with `?export`; external subscriptions use the original source ICS URL.
- n8n's Redis node supports an atomic `INCR` operation and optional TTL; the notification workflow uses it for short delivery claims.

### n8n 2.7.3 / CalDAV implementation note

- The target n8n instance is currently 2.7.3. At that version the HTTP Request node does not have the required WebDAV methods in the workflow design, so CalDAV `PROPFIND`/`REPORT` operations remain in Code nodes using `this.helpers.httpRequest`.
- DAV calls use full responses and `ignoreHttpStatusErrors: true` so Nextcloud/reverse-proxy error bodies can be surfaced with useful diagnostics.
- In this n8n 2.7.3 task-runner environment, do not rely on the WHATWG global `URL` constructor inside Code nodes. Calendar discovery uses string-based HTTP(S) URL parsing/resolution so valid values such as `https://cloud.idle.laziness.rocks` work in the sandbox.
