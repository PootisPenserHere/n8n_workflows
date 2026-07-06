# Web Search Workflows

This directory contains reusable n8n workflows for running Brave Web Search, fetching every returned result URL through the standalone Jina Reader workflow, and returning normalized records to other workflows.

## Files

| File | Purpose |
| --- | --- |
| `web-search-brave-api-reader.workflow.json` | Main callable workflow. Receives a search query, calls Brave Search, calls `Jina Reader - Fetch URL` once per unique Brave result, and returns normalized records with content. |
| `test-web-search-brave-api-reader.workflow.json` | Manual test workflow. Sends a sample payload to the main workflow and shows a compact preview. |
| `README.md` | Local setup and usage notes for these web search workflows. |

AI implementation context is kept in the repository root at `AI_CONTEXT.md`, not in this workflow directory. From this directory, the relative path is `../../AI_CONTEXT.md`.

## Main workflow

**Workflow name:** `Web Search - Brave API + Jina Reader Workflow`

This workflow is intended to be called from other workflows using n8n's Execute Workflow / sub-workflow mechanism.

High-level flow:

```text
When Executed by Another Workflow
  -> Normalize Input
  -> Brave Web Search
  -> Build Reader Queue
  -> Has Candidate URL?
      true  -> Call Jina Reader Workflow
                  -> Attach Reader Workflow Response
                  -> Format Final Response
      false -> Format Final Response
```

The workflow no longer calls Jina Reader directly. It delegates each URL fetch to the standalone **Jina Reader - Fetch URL** workflow, which handles Redis rate limiting, wait/backoff behavior, Reader HTTP retries, and normalized Reader errors.

## Required setup

1. Import and configure `workflows/jina-reader/jina-reader-fetch-url.workflow.json` first.
2. In the Jina Reader workflow, open **Increment Rate Counter** and select the local Redis credential.
3. Import `web-search-brave-api-reader.workflow.json`.
4. Open **Brave Web Search** and select the local Brave HTTP Header Auth credential.
5. Open **Call Jina Reader Workflow** and select the imported **Jina Reader - Fetch URL** workflow.
6. Save the main workflow.
7. Import `test-web-search-brave-api-reader.workflow.json`.
8. Open **Call Web Search Reader Workflow** and select the imported main Brave workflow.
9. Save and run the test workflow.

## Required credentials

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

The Brave workflow itself does not need Redis credentials. Redis is configured in the standalone `Jina Reader - Fetch URL` workflow.

## Input contract

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

| Field | Default | Limits / allowed values | Description |
| --- | ---: | --- | --- |
| `query` | none | non-empty string | Search query sent to Brave. |
| `count` | `10` | `1` to `20` | Number of unique Brave candidates to fetch and enrich. |
| `maxContentChars` | `6000` | `1000` to `200000` | Passed to the Jina Reader workflow for each URL. |
| `requestTimeoutMs` | `60000` | `1000` to `300000` | Passed to the Jina Reader workflow for each URL. |
| `redisRateLimitKey` | `jina_reader:free:rpm` | string | Passed to the Jina Reader workflow. |
| `rateLimitMaxRequests` | `20` | `1` to `1000` | Passed to the Jina Reader workflow. |
| `rateLimitWindowSeconds` | `60` | `1` to `3600` | Passed to the Jina Reader workflow. |
| `rateLimitSleepBufferSeconds` | `5` | `0` to `3600` | Passed to the Jina Reader workflow. |
| `maxAttempts` | `3` | `1` to `20` | Total Reader HTTP fetch attempts per URL. First fetch is attempt 1. |
| `country` | `US` | Brave-supported country code | Country parameter sent to Brave. |
| `search_lang` | `en` | Brave-supported search language | Search language parameter sent to Brave. |
| `ui_lang` | `en-US` | Brave-supported UI language | UI language parameter sent to Brave. |
| `freshness` | empty string | empty, `pd`, `pw`, `pm`, `py`, or `YYYY-MM-DDtoYYYY-MM-DD` | Optional freshness filter sent to Brave. |
| `safesearch` | `moderate` | `off`, `moderate`, `strict` | Safe-search setting sent to Brave. |

`readTopN` and `readerDelaySeconds` are no longer part of the active contract. The workflow fetches content for all unique Brave candidates returned by `count`; delay and rate-limit behavior live in `Jina Reader - Fetch URL`.

## Output contract

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

If some Reader sub-workflow calls fail but Brave Search succeeds, the workflow returns `status: "partial_error"` and preserves all records with `reader.status: "error"` on failed records. If every Reader call fails, the workflow returns `status: "error"` with `records[]` still present so callers can inspect the Brave metadata and Reader errors.

### Record shape

Each returned record includes Brave metadata plus Reader output:

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

For downstream workflows, prefer `records[].content`. `records[].reader.content` is retained for compatibility with the older Brave workflow shape.

## Error behavior

The workflow distinguishes between search-level errors and Reader-level errors:

- Missing/invalid search input or Brave HTTP failure returns a normalized top-level `status: "error"` with no records.
- Reader failures are returned inside each record at `record.reader.error` and summarized in `metadata.readerStats`, `metadata.readerFailureCount`, and `metadata.failedReaderRecords`.
- The standalone Jina Reader workflow passes actual Reader error details through `retry.errors[]`, and this Brave workflow preserves that under `record.reader.retry`.

## Reader delegation and rate limits

The Brave workflow intentionally delegates all Reader concerns to **Jina Reader - Fetch URL**:

- Redis simple-counter rate limiting.
- Wait/backoff when the free Reader limit is hit.
- Reader HTTP retry attempts.
- Reader URL normalization and `https://r.jina.ai/${url}` construction.
- Normalized Reader success/error responses.

Because the Reader sub-workflow handles rate limiting and sleeping internally, this Brave workflow now fetches content for every unique Brave result returned by `count` rather than limiting to the old `readTopN` subset.

## Development notes

- Keep this workflow callable and focused on search + delegating content reads.
- Keep the test workflow in the same directory and update it whenever the main workflow input contract changes.
- Keep root `AI_CONTEXT.md` updated when external API behavior, rate-limit assumptions, workflow contracts, or design decisions change.
- Do not hard-code API keys in workflow JSON. Use n8n credentials.
- Reranking is intentionally not enabled yet. A future version can add a rerank step after content is fetched for all candidates.
