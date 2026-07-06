# Jina Reader Workflows

This directory contains a reusable n8n workflow for fetching one URL through the free Jina Reader endpoint and returning normalized markdown content to caller workflows.

AI implementation context is kept in the repository root at `AI_CONTEXT.md`, not in this workflow directory. From this directory, the relative path is `../../AI_CONTEXT.md`.

## Files

| File | Purpose |
| --- | --- |
| `jina-reader-fetch-url.workflow.json` | Main callable workflow. Receives a URL, applies a Redis-backed simple rate limit, calls Jina Reader, and returns normalized content. |
| `test-jina-reader-fetch-url.workflow.json` | Manual smoke-test workflow that calls the main workflow and returns a compact preview. |
| `README.md` | Local setup and usage notes. |

## Main workflow

**Workflow name:** `Jina Reader - Fetch URL`

High-level flow:

```text
When Executed by Another Workflow
  -> Normalize Input
  -> Increment Rate Counter
  -> Attach Rate Limit State
  -> Rate Limit Available?
      true  -> Jina Reader -> Format Reader Response
      false -> Wait For Rate Limit Window -> Increment Rate Counter
```

## Why the Reader URL is built this way

The workflow intentionally mirrors the working Brave search workflow and builds the Reader URL with string concatenation:

```js
readerUrl: `https://r.jina.ai/${url}`
```

Do not replace this with `new URL(...)` parsing unless there is a specific reason and it has been tested inside n8n. Earlier versions failed before the HTTP Request node when protocol-relative URLs were parsed too aggressively. The current workflow only performs lightweight string cleanup, then uses the same Reader construction pattern as the Brave workflow.

## Required credential

Create or reselect an n8n **Redis** credential for the `Increment Rate Counter` node after import.

No Jina credential is required for this version. It uses the free/no-key Reader endpoint.

## Input contract

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

Accepted URL aliases: `url`, `targetUrl`, `sourceUrl`, `href`, `link`.

| Field | Required | Default | Description |
| --- | --- | --- | --- |
| `url` | Yes | none | Target URL to fetch. HTTP, HTTPS, protocol-relative URLs, bare hostnames, and already-built `https://r.jina.ai/...` inputs are accepted. |
| `maxContentChars` | No | `6000` | Maximum characters retained from Reader output. Clamped from `1000` to `200000`. |
| `requestTimeoutMs` | No | `60000` | HTTP timeout for the Reader request. Clamped from `1000` to `300000`. |
| `redisRateLimitKey` | No | `jina_reader:free:rpm` | Redis counter key used across executions/workflows. Use the same key anywhere sharing the free Jina limit. |
| `rateLimitMaxRequests` | No | `20` | Allowed attempts per Redis window. Defaults to the free/no-key Reader RPM. |
| `rateLimitWindowSeconds` | No | `60` | TTL set on the Redis counter after every increment. |
| `rateLimitSleepBufferSeconds` | No | `5` | Extra seconds added to the remaining TTL when the workflow hits the limit. |

## Redis rate-limit behavior

This intentionally uses a very simple counter instead of a sliding window:

1. The workflow increments `redisRateLimitKey` before every Reader request attempt.
2. The Redis `INCR` node has `expire: true` and `ttl: 60`, so every attempt resets the key TTL.
3. If the counter is `<= rateLimitMaxRequests`, the workflow calls Jina Reader.
4. If the counter is above the limit, the workflow waits `remainingTtlSeconds + rateLimitSleepBufferSeconds` and loops back to increment/check again.
5. Because the TTL is reset on every increment, the workflow treats the remaining TTL as `rateLimitWindowSeconds`; with defaults, the wait is `60 + 5 = 65` seconds.

This counts attempts whether the subsequent Reader request succeeds or fails, matching the Jina free endpoint assumption.

## Output contract

Successful response:

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
  "content": "Title: ...",
  "reader": {},
  "rateLimit": {},
  "request": {},
  "metadata": {},
  "receivedAt": "2026-07-06T00:26:54.039Z"
}
```

Use the top-level `content` field as the preferred key for downstream workflows and AI nodes. `contentPreview` is only used by the test workflow.

## Long waits and constraints

The default limit-hit wait is 65 seconds. In n8n, Wait nodes can wait for seconds, minutes, hours, or days. For waits shorter than 65 seconds, n8n does not offload the execution data to the database; at 65 seconds or longer, the waiting execution can be offloaded and later resumed. Keep workflow execution timeout settings high enough if a parent workflow may call this repeatedly for hours.

## Import checklist

1. Import `jina-reader-fetch-url.workflow.json`.
2. Open **Increment Rate Counter** and select your local Redis credential.
3. Save the main workflow.
4. Import `test-jina-reader-fetch-url.workflow.json`.
5. Open **Call Jina Reader Workflow** and select the imported main workflow.
6. Run the test workflow manually.
7. Confirm `status: "ok"`, `fetched: true`, `content` is populated, and `rateLimit.counter <= 20`.
