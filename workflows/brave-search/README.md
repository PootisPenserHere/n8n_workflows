# Web Search Workflows

This directory contains reusable n8n workflows for running a web search, enriching the top search results with page content, and returning a normalized response to other workflows.

## Files

| File | Purpose |
| --- | --- |
| `web-search-brave-api-reader.workflow.json` | Main callable workflow. Receives a search query, calls Brave Search, fetches selected result pages through Jina Reader, and returns normalized records. |
| `test-web-search-brave-api-reader.workflow.json` | Manual test workflow. Sends a sample payload to the main workflow and shows a compact preview of the response. |
| `README.md` | Local setup and usage notes for these web search workflows. |

AI implementation context is kept in the repository root at `AI_CONTEXT.md`, not in this workflow directory. From this directory, the relative path is `../../AI_CONTEXT.md`.

## Main workflow

**Workflow name:** `Web Search - Brave API + Reader`

This workflow is intended to be called from other workflows using n8n's Execute Workflow / sub-workflow mechanism.

High-level flow:

```text
When Executed by Another Workflow
  -> Normalize Input
  -> Brave Web Search
  -> Build Reader Queue
  -> Loop Over Reader URLs
  -> Jina Reader
  -> Wait Between Reader Calls
  -> Format Final Response
```

The workflow currently uses Brave's ranking as the first-pass ordering. It does not use a dedicated reranker yet.

## Test workflow

**Workflow name:** `Test - Web Search Brave API + Reader`

Use this workflow after importing the main workflow. It builds a sample input payload, calls the main workflow, and returns a preview with:

- overall status
- provider
- query
- candidate count
- returned record count
- Reader status counts
- first three enriched results
- full response payload

After importing, open the **Call Web Search Reader Workflow** node and select the imported `Web Search - Brave API + Reader` workflow from the dropdown. The exported workflow contains a placeholder workflow ID that must be replaced in your n8n instance.

## Required credential

Create an n8n credential using **HTTP Header Auth**.

Suggested credential display name:

```text
Brave Search API
```

Credential fields:

```text
Name:  X-Subscription-Token
Value: <your Brave Search API key>
```

After importing the main workflow, open the **Brave Web Search** HTTP Request node and select this credential. Imported workflow exports can contain stale credential IDs, so always reselect the credential in your own n8n instance.

## Input contract

The main workflow accepts one input item with this JSON shape.

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

### Input fields

| Field | Required | Default | Limits / allowed values | Description |
| --- | --- | --- | --- | --- |
| `query` | Yes | none | non-empty string | Search query. Aliases accepted by the workflow: `q`, `searchQuery`. |
| `count` | No | `10` | `1` to `20` | Number of Brave search candidates to request and normalize. Alias accepted: `limit`. |
| `readTopN` | No | `3` | `0` to `5` | Number of top URLs to fetch with Jina Reader. Aliases accepted: `read_top_n`, `readerLimit`. |
| `readerDelaySeconds` | No | `4` | `1` to `60` | Delay between Jina Reader requests. Alias accepted: `reader_delay_seconds`. |
| `maxContentChars` | No | `6000` | `1000` to `50000` | Maximum number of characters kept from each Reader response. Alias accepted: `max_content_chars`. |
| `country` | No | `US` | Brave-supported country code | Country parameter sent to Brave. |
| `search_lang` | No | `en` | Brave-supported search language | Search language parameter sent to Brave. |
| `ui_lang` | No | `en-US` | Brave-supported UI language | UI language parameter sent to Brave. |
| `freshness` | No | empty string | empty, `pd`, `pw`, `pm`, `py`, or `YYYY-MM-DDtoYYYY-MM-DD` | Optional freshness filter sent to Brave. |
| `safesearch` | No | `moderate` | `off`, `moderate`, `strict` | Safe-search setting sent to Brave. |

## Output contract

Successful responses use this top-level shape.

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

### Output fields

| Field | Description |
| --- | --- |
| `status` | `ok` or `error`. |
| `provider` | Current value is `brave+jina_reader`. |
| `query` | Normalized search query. |
| `candidateCount` | Number of unique Brave candidates prepared by the workflow. |
| `recordCount` | Number of records returned in `records`. In this version, this normally matches the Reader fetch count, not the full Brave candidate count. |
| `records` | Array of normalized search result records enriched with Reader data when available. |
| `request` | Normalized request settings used by the workflow. |
| `metadata` | Runtime metadata such as Reader stats and strategy name. |
| `receivedAt` | Timestamp when the final response was formatted. |

### Record shape

Each returned record has this general structure.

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

| Status | Meaning |
| --- | --- |
| `ok` | Jina Reader returned content and the workflow attached it to the record. |
| `error` | Jina Reader failed for that URL, but the workflow preserved the record and attached error details. |
| `skipped` | The workflow did not fetch Reader content for the record, usually because no Reader URL was available or `readTopN` was `0`. |

## Error response

If the workflow fails before producing records, it returns a normalized error response.

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

## Rate-limit behavior

The workflow fetches Reader content one URL at a time and waits between Reader calls.

Default values:

```json
{
  "readTopN": 3,
  "readerDelaySeconds": 4,
  "maxContentChars": 6000
}
```

Keep `readTopN` small when using the free Jina Reader endpoint. For broader searches, prefer increasing `count` first and keeping `readTopN` between `3` and `5`.

Recommended starting points:

| Use case | `count` | `readTopN` | `readerDelaySeconds` | `maxContentChars` |
| --- | ---: | ---: | ---: | ---: |
| Fast smoke test | `5` | `1` | `4` | `3000` |
| Normal AI grounding | `10` | `3` | `4` | `6000` |
| Deeper research | `20` | `5` | `4` to `8` | `10000` |

## Import checklist

1. Import `web-search-brave-api-reader.workflow.json`.
2. Open **Brave Web Search** and select the local Brave HTTP Header Auth credential.
3. Save the main workflow.
4. Import `test-web-search-brave-api-reader.workflow.json`.
5. Open **Call Web Search Reader Workflow** and select the imported main workflow.
6. Save the test workflow.
7. Run the test workflow manually.
8. Confirm the output has `status: "ok"`, `provider: "brave+jina_reader"`, and at least one record with `reader.status: "ok"`.

## Development notes

- Keep this workflow callable and focused on search + content enrichment.
- Keep the test workflow in the same directory and update it whenever the main workflow input contract changes.
- Keep root `AI_CONTEXT.md` updated when external API behavior, rate-limit assumptions, or workflow design decisions change.
- Do not create workflow-specific AI context files inside this directory.
- Do not hard-code API keys in workflow JSON. Use n8n credentials.
- Reranking is intentionally not enabled yet. A future version can add a rerank step between Brave candidate collection and Jina Reader fetching.

## Suggested directory layout

```text
AI_CONTEXT.md
workflows/
  web-search/
    README.md
    web-search-brave-api-reader.workflow.json
    test-web-search-brave-api-reader.workflow.json
```
