# AI Reference

This file is the single repository-level AI context for this n8n workflow collection.

Keep this file in the repository root and update it whenever workflow behavior, input/output contracts, credentials, external API assumptions, or design decisions change. Do not create workflow-specific AI reference files inside workflow directories; directory READMEs should link back to this root file instead.

## Repository conventions

- Workflows are stored as exported n8n JSON files under `workflows/<domain>/`.
- Workflow directory READMEs describe local import/setup/use details.
- Cross-workflow AI context, research notes, API assumptions, and architectural decisions live only in this root `AI_REFERENCE.md`.
- Do not hard-code secrets in workflow JSON. Use n8n credentials.
- Imported workflow JSON can contain stale credential IDs or workflow IDs from another n8n instance. After import, reselect credentials and called workflows from the local n8n UI.

## Web search workflows - Brave API + Jina Reader

### Current files

- `workflows/web-search/README.md`
- `workflows/web-search/web-search-brave-api-reader.workflow.json`
- `workflows/web-search/test-web-search-brave-api-reader.workflow.json`

Earlier first-slice files may exist in history or local testing, but the current recommended workflow pair is the `+ Reader` version.

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
  - Used to confirm the callable workflow starts with **Execute Sub-workflow Trigger / When Executed by Another Workflow**.
- n8n Execute Sub-workflow documentation: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.executeworkflow/
  - Used to confirm parent workflows can call the search workflow and wait for the sub-workflow response.
- n8n HTTP Request node documentation: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/
  - Used for Brave and Jina Reader HTTP calls.
- n8n HTTP Request credentials documentation: https://docs.n8n.io/integrations/builtin/credentials/httprequest/
  - Used for the Brave `X-Subscription-Token` HTTP Header Auth credential.
- n8n rate-limit documentation: https://docs.n8n.io/integrations/builtin/rate-limits/
  - Used for the Loop Over Items + Wait approach to avoid bursting Reader requests.
- n8n Loop Over Items documentation: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.splitinbatches/
  - Used for one-URL-at-a-time Reader processing.
- Jina Reader API documentation: https://jina.ai/reader/
  - Used to confirm the free Reader endpoint is `https://r.jina.ai/`, the no-key limit is 20 RPM, and URLs can be read by prepending `https://r.jina.ai/` to the target URL.
- Brave Web Search API reference: https://api-dashboard.search.brave.com/api-reference/web/search/get
  - Used to confirm `GET https://api.search.brave.com/res/v1/web/search`, the required `q` parameter, `count` limits, `freshness`, `result_filter`, and the `X-Subscription-Token` header.

### Business decisions

- The current reusable workflow is named **Web Search - Brave API + Reader**.
- It is designed to be called by other workflows through **Execute Sub-workflow / Execute Workflow**.
- The companion workflow **Test - Web Search Brave API + Reader** exists only for manual testing and smoke checks.
- This iteration intentionally does not add a true reranker yet.
- The current strategy is: over-retrieve from Brave, dedupe URLs, then read only the top `readTopN` URLs using Jina Reader.
- Reader calls are rate-controlled with **Loop Over Items** batch size 1 plus **Wait Between Reader Calls**.
- Brave API key must remain in n8n credentials, never in workflow JSON.
- The Jina Reader integration currently uses the free no-key endpoint. Keep request volume low and add a credentialed Jina path later only if needed.
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

The main workflow accepts one input item with this JSON shape:

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
- Current default: `readTopN: 3` and `readerDelaySeconds: 4`.
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

## Standalone Jina Reader workflow - Fetch URL

### Current files

- `workflows/jina-reader/README.md`
- `workflows/jina-reader/jina-reader-fetch-url.workflow.json`
- `workflows/jina-reader/test-jina-reader-fetch-url.workflow.json`

### Purpose

The standalone Jina Reader workflow is a reusable callable workflow that other n8n workflows can use when they already have a URL and only need page content. It is intentionally separate from the Brave search workflow, which performs search first and then enriches selected search results with Reader content.

This first slice intentionally stays small:

1. Receives one URL from another workflow.
2. Normalizes and validates the URL.
3. Fetches page content through `https://r.jina.ai/<target-url>`.
4. Returns either a normalized success response with markdown content or a normalized error response.

### Sources used

- Jina Reader API documentation: https://jina.ai/reader/
  - Used to confirm the free/no-key Reader pattern of prepending `https://r.jina.ai/` to the target URL.
- n8n Execute Sub-workflow Trigger documentation: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.executeworkflowtrigger/
  - Used to keep the workflow callable by other workflows.
- n8n Execute Sub-workflow documentation: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.executeworkflow/
  - Used to confirm the companion test workflow can call the reusable workflow and wait for the sub-workflow response.
- n8n HTTP Request node documentation: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/
  - Used for the Jina Reader HTTP call.

### Business decisions

- The reusable workflow is named **Jina Reader - Fetch URL**.
- It is designed to be called by other workflows through **Execute Sub-workflow / Execute Workflow**.
- The companion workflow **Test - Jina Reader Fetch URL** exists only for manual testing and smoke checks.
- The workflow accepts a single URL and returns a single normalized response.
- No Jina credential is required for this first slice. It uses the free unauthenticated Reader endpoint.
- This first slice does not add Redis rate limiting, retries, batching, or authenticated Jina support yet.
- Error responses should avoid returning raw request/response objects that may contain credentials or sensitive headers.

### Credential requirements

No credential is required for this first slice.

### Input contract

The workflow accepts one input item with this JSON shape:

```json
{
  "url": "https://example.com/article",
  "maxContentChars": 6000,
  "requestTimeoutMs": 60000
}
```

Accepted aliases:

- `url`: `targetUrl`, `sourceUrl`
- `maxContentChars`: `max_content_chars`
- `requestTimeoutMs`: `request_timeout_ms`

Accepted URL forms:

- `https://example.com/page`
- `http://example.com/page`
- `//example.com/page`, coerced to HTTPS
- `example.com/page`, coerced to HTTPS
- `https://r.jina.ai/https://example.com/page`, recovered to the target URL

Defaults and limits:

- `maxContentChars`: default `6000`, clamped from `1000` to `200000`.
- `requestTimeoutMs`: default `60000`, clamped from `1000` to `300000`.

### Output contract

Successful responses use this top-level shape:

```json
{
  "status": "ok",
  "provider": "jina_reader",
  "url": "https://example.com/article",
  "readerUrl": "https://r.jina.ai/https://example.com/article",
  "fetched": true,
  "contentType": "markdown",
  "contentChars": 6000,
  "originalContentChars": 12000,
  "truncated": true,
  "content": "Title: ...
URL Source: ...

Markdown content...",
  "reader": {},
  "request": {},
  "metadata": {},
  "receivedAt": "2026-07-05T00:00:00.000Z"
}
```

Error responses use this top-level shape:

```json
{
  "status": "error",
  "provider": "jina_reader",
  "url": "https://example.com/article",
  "readerUrl": "https://r.jina.ai/https://example.com/article",
  "fetched": false,
  "content": null,
  "error": {
    "message": "Missing required input field: url",
    "name": null,
    "statusCode": null
  },
  "request": {},
  "metadata": {
    "strategy": "single_url_jina_reader_free_endpoint"
  },
  "receivedAt": "2026-07-05T00:00:00.000Z"
}
```



### Implementation notes - 2026-07-06 patch

- The standalone Reader workflow error formatter must preserve n8n string-style Code node errors. Earlier exports could return a generic `Jina Reader workflow failed` message while hiding the useful error in `metadata.inputPreview`.
- URL normalization accepts `url`, `targetUrl`, `sourceUrl`, `href`, and `link` inputs.
- Protocol-relative URLs such as `//docs.n8n.io/connect/create-nodes/overview` are normalized to HTTPS before constructing the Reader URL.
- The companion test workflow should include both a normal full URL test and a protocol-relative URL regression test.

### Rate-limit assumptions

- Jina Reader free/no-key usage should still be treated conservatively, even though this first slice does not yet implement a shared rate limiter.
- Parent workflows that call this repeatedly should keep volume low until a later slice adds shared rate limiting and retries.

### Future work

- Add shared rate limiting if multiple workflows will call Reader frequently.
- Add retry policy for transient Reader failures.
- Add optional authenticated Jina support if higher throughput is needed.
- Consider a separate batch wrapper workflow if parent workflows often need to fetch many URLs and aggregate the results.


### Patch note - Jina Reader callable v3

The standalone callable **Jina Reader - Fetch URL** workflow was patched after testing exposed a protocol-relative URL normalization failure such as `//serper.dev/ [line 54]`.

v3 design decisions:

- URL normalization now parses with a safe base URL so protocol-relative inputs like `//example.com/page` resolve to `https://example.com/page`.
- Bare hostnames such as `example.com/page` are still treated as HTTPS URLs before parsing.
- Already-built Reader URLs such as `https://r.jina.ai/https://example.com/page` are normalized back to the target URL before rebuilding `readerUrl`.
- Error responses preserve the original trigger input when normalization fails, so callers can see the attempted `url` instead of only the n8n error output.
- The test workflow includes full URL, protocol-relative URL, and bare-hostname smoke cases.


## Jina Reader standalone workflow

### Current files

- `workflows/jina-reader/README.md`
- `workflows/jina-reader/jina-reader-fetch-url.workflow.json`
- `workflows/jina-reader/test-jina-reader-fetch-url.workflow.json`

### Purpose

The standalone Jina Reader workflow is a reusable callable workflow that other n8n workflows can use when they already have a URL and only need Reader-enriched page content. It intentionally does not perform search.

### Current implementation

1. Receives one input item from another workflow.
2. Normalizes a single URL input.
3. Constructs the Reader URL with the same simple pattern used by the working Brave Search + Reader workflow: `https://r.jina.ai/${url}`.
4. Calls the free/no-key Jina Reader endpoint.
5. Returns normalized markdown content or a normalized error response.

### Input contract

```json
{
  "url": "https://serper.dev/",
  "maxContentChars": 6000,
  "requestTimeoutMs": 60000
}
```

Accepted URL aliases: `url`, `targetUrl`, `sourceUrl`, `href`, and `link`.

Accepted URL forms:

- `https://example.com/page`
- `http://example.com/page`
- `//example.com/page`
- `example.com/page`
- `https://r.jina.ai/https://example.com/page`

Defaults and limits:

- `maxContentChars`: default `6000`, clamped from `1000` to `200000`.
- `requestTimeoutMs`: default `60000`, clamped from `1000` to `300000`.

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
  "originalContentChars": 12000,
  "truncated": true,
  "content": "Title: ...
URL Source: ...

Markdown content...",
  "request": {},
  "metadata": {},
  "receivedAt": "2026-07-06T00:00:00.000Z"
}
```

Error responses use this top-level shape:

```json
{
  "status": "error",
  "provider": "jina_reader",
  "url": "https://serper.dev/",
  "readerUrl": null,
  "fetched": false,
  "content": null,
  "contentChars": 0,
  "originalContentChars": 0,
  "truncated": false,
  "error": {
    "message": "Jina Reader workflow failed",
    "name": null,
    "statusCode": null
  },
  "request": {},
  "metadata": {},
  "receivedAt": "2026-07-06T00:00:00.000Z"
}
```

### Business decisions

- The standalone workflow is named **Jina Reader - Fetch URL**.
- The companion workflow is named **Test - Jina Reader Fetch URL**.
- This workflow is intentionally separate from Brave Search. Use it when a parent workflow already has the target URL.
- The workflow is credential-free in this first slice and uses the free Jina Reader endpoint.
- URL handling intentionally mirrors the existing working Brave Search + Reader workflow and avoids `new URL(...)`; the target URL is treated as a string and the Reader URL is built as `https://r.jina.ai/${url}`.
- The workflow accepts protocol-relative and bare-hostname inputs, but normalizes them to HTTPS before calling Reader.
- Error responses should avoid returning raw request/response objects that may contain sensitive data.

### Patch history

- v2 improved error reporting for n8n string-style Code-node errors and added URL aliases.
- v3 attempted URL parsing with a base URL for protocol-relative inputs.
- v4 removed URL parser usage and switched to string-only normalization to match the working Brave Search + Reader implementation.


## Jina Reader callable workflow - Redis rate-limited single URL reader

### Current files

- `workflows/jina-reader/README.md`
- `workflows/jina-reader/jina-reader-fetch-url.workflow.json`
- `workflows/jina-reader/test-jina-reader-fetch-url.workflow.json`

### Purpose

This standalone workflow is a reusable callable Reader workflow for other n8n workflows. It accepts one URL, fetches it through Jina Reader, and returns normalized markdown content without requiring Brave Search.

### Sources used

- Jina Reader API documentation: https://jina.ai/reader/
  - Used to confirm the free Reader endpoint is `https://r.jina.ai/`, URLs can be read by prepending `https://r.jina.ai/` to the target URL, and the no-key Reader API rate limit is currently 20 RPM.
- n8n Redis node documentation/source:
  - Used to confirm the built-in Redis node supports `Increment`, and that increment can set `expire: true` with a `ttl`, which performs the counter increment and then sets key expiration.
- n8n Wait node documentation:
  - Used to confirm Wait can pause by time interval and supports seconds, minutes, hours, and days. It also confirms waits shorter than 65 seconds do not offload execution data to the database, while longer waits can be offloaded and resumed.

### Business decisions

- The workflow name is **Jina Reader - Fetch URL**.
- It is designed to be called by other workflows through **Execute Sub-workflow / Execute Workflow**.
- The companion workflow **Test - Jina Reader Fetch URL** exists only for manual smoke testing.
- The workflow uses the free/no-key Jina Reader endpoint. No Jina credential is required in this first Redis-rate-limited version.
- The Reader URL is intentionally built with the same string-concatenation pattern that works in the Brave workflow:

```js
readerUrl: `https://r.jina.ai/${url}`
```

- Do **not** replace this with `new URL(...)` parsing unless the change is specifically tested inside n8n. Earlier standalone versions failed in the normalize step before the HTTP Request node. The reliable pattern is lightweight string normalization followed by direct `https://r.jina.ai/${url}` construction.
- The top-level `content` key is the preferred output key for downstream workflows and AI nodes to read the markdown returned from the URL. `contentPreview` is only for test/debug views and should not be treated as canonical content.
- Error responses should avoid returning raw request/response objects that may contain credentials or sensitive headers.

### Credential requirements

Create or reselect an n8n **Redis** credential for the **Increment Rate Counter** node after import.

The workflow does not require a Jina credential while using the free/no-key Reader endpoint.

### Input contract

The main workflow accepts one input item with this JSON shape:

```json
{
  "url": "https://serper.dev/",
  "maxContentChars": 6000,
  "requestTimeoutMs": 60000,
  "redisRateLimitKey": "jina_reader:free:rpm",
  "rateLimitMaxRequests": 20,
  "rateLimitWindowSeconds": 60,
  "rateLimitSleepBufferSeconds": 5
}
```

Accepted URL aliases:

- `url`: `targetUrl`, `sourceUrl`, `href`, `link`

Defaults and limits:

- `maxContentChars`: default `6000`, clamped from `1000` to `200000`.
- `requestTimeoutMs`: default `60000`, clamped from `1000` to `300000`.
- `redisRateLimitKey`: default `jina_reader:free:rpm`.
- `rateLimitMaxRequests`: default `20`, clamped from `1` to `1000`.
- `rateLimitWindowSeconds`: default `60`, clamped from `1` to `3600`.
- `rateLimitSleepBufferSeconds`: default `5`, clamped from `0` to `3600`.

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
  "originalContentChars": 8280,
  "truncated": true,
  "content": "Title: ...
URL Source: ...

Markdown Content: ...",
  "reader": {
    "status": "ok",
    "fetched": true,
    "provider": "jina_reader",
    "readerUrl": "https://r.jina.ai/https://serper.dev/"
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
    "strategy": "single_url_jina_reader_free_endpoint_with_redis_simple_counter_rate_limit",
    "contentKey": "content"
  },
  "receivedAt": "2026-07-06T00:26:54.039Z"
}
```

### Rate-limit behavior

- This workflow intentionally uses a simple Redis counter, not a sliding window.
- Redis key: default `jina_reader:free:rpm`.
- Limit: default `20` attempts per `60` seconds for the free/no-key Jina Reader endpoint.
- The workflow increments the Redis counter **before** the Reader request.
- The Redis **Increment Rate Counter** node has `expire: true` and `ttl: 60`, so every attempt resets the counter key TTL to 60 seconds.
- Attempts are counted whether the later Reader request succeeds or fails.
- If the incremented counter is above the limit, the workflow does **not** call Jina Reader. It waits `remainingTtlSeconds + rateLimitSleepBufferSeconds` and then loops back to increment/check again.
- Because the workflow resets TTL on every increment, the effective remaining TTL immediately after a limit-hit increment is treated as `rateLimitWindowSeconds`. With defaults, wait time is `60 + 5 = 65` seconds.
- A 65-second default wait is intentional because n8n does not offload waits shorter than 65 seconds to the database. This keeps long backoff loops from holding the process hot.
- If caller workflows may wait/retry for hours, ensure n8n workflow timeout settings and execution-data retention are configured accordingly.

### Future work

- Consider adding an optional credentialed Jina path for higher throughput.
- Consider a more precise Redis Lua or REST implementation if exact TTL reads are needed later. For this step, the requested behavior is deliberately simple and treats TTL as freshly reset after every increment.
