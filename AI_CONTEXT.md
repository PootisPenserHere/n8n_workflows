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
