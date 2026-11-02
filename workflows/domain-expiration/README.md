# Domain expiration — configured domains

Import **Domain expiration - Configured domains.json** to replace the three per-domain workflows. One daily execution loads the domain list from PostgreSQL and checks each domain in order, including its optional Telegram notification, before starting the next. There are no staggered schedules or waits.

Repository-wide architecture and compatibility notes live in [AI_CONTEXT.md](../../AI_CONTEXT.md#domain-expiration--configured-domains).

## Files

- [Domain expiration - Configured domains.json](<Domain expiration - Configured domains.json>): the single importable workflow, exported inactive.
- [config.example.sql](../../database/domain-expiration/config.example.sql): configuration insert/upsert for all three existing domains and a non-overwriting seed for the shared Telegram chat.
- [test-domain-expiration.cjs](test-domain-expiration.cjs): offline checks for the embedded Code nodes and workflow routes.

## Flow

```mermaid
flowchart TD
    Trigger[Daily at 01:00 or manual run] --> Read[Read key-value config]
    Read --> Parse[Parse JSON text, validate and deduplicate domains]
    Parse --> Loop[Loop Domains: batch size 1]
    Loop -->|loop| Fetch[Fetch ICANN data: 30-second timeout]
    Fetch --> Analyze[Parse expiration or normalize lookup error]
    Analyze --> Notify{Notification required?}
    Notify -->|no| Loop
    Notify -->|yes| Error{Lookup error?}
    Error -->|yes| ErrorBot[Telegram error bot]
    Error -->|no| AlertBot[Telegram expiration bot]
    ErrorBot --> Record[Record notification result]
    AlertBot --> Record
    Record --> Loop
    Loop -->|done| Summary[Run Summary]
```

The schedule is `0 1 * * *`, using the workflow/instance time zone, as the original 01:00 check did. Confirm the intended time zone in n8n settings when importing. The domain array determines processing order; each normalized domain is checked once per execution.

## Configuration

The existing [table schema](../../database/table_key_value_store.sql) uses `name` for the key and **`data TEXT` for the value**. No schema change or JSON column is needed.

| Key | Value in `data` |
| --- | --- |
| `DOMAIN_EXPIRATION_CONFIG` | A JSON object serialized as a string; `domains` is required. |
| `PERSONAL_TELEGRAM_CHAT_ID` | Numeric chat ID as text, shared with existing workflows. |

The JSON object stored inside `DOMAIN_EXPIRATION_CONFIG.data` is:

```json
{
  "domains": [
    "aramburo.dev",
    "laziness.rocks",
    "perfildelinversionistainverplux.com"
  ]
}
```

When writing from application code, set `data = JSON.stringify(config)`. Serialize once: do not store a JSON string containing another JSON string. The workflow calls `JSON.parse(row.data)` after reading the text value.

Sample insert for the current domains:

```sql
INSERT INTO public.key_value_store (name, data, description)
VALUES (
    'DOMAIN_EXPIRATION_CONFIG',
    '{"domains":["aramburo.dev","laziness.rocks","perfildelinversionistainverplux.com"]}'::jsonb::text,
    'Domain expiration monitor: serialized JSON domain list and optional lookupUrl'
)
ON CONFLICT (name) DO UPDATE
SET data = EXCLUDED.data,
    description = EXCLUDED.description;
```

The `::jsonb::text` casts validate the SQL literal as JSON and store the serialized result as text. The complete [SQL example](../../database/domain-expiration/config.example.sql) also inserts the original chat ID only if the shared key is absent. An existing chat ID is preserved. Re-running the domain upsert replaces the entire list.

To add or remove a domain, edit this array in the database; the next run reads the updated value. No workflow edit or separate workflow import is required. Use an empty array, `{"domains":[]}`, to pause all domain checks; the execution stops at configuration parsing without lookups, notifications, or a run summary.

Domain entries must be bare DNS names, with no scheme, path, query string, or port. Internationalized names must use punycode. Names are trimmed, lowercased, and stripped of one trailing dot; duplicates are removed while preserving their first position. The complete list is validated before any lookup starts. Missing keys, malformed JSON, an invalid domain entry, or an invalid chat ID fail the execution at **Parse Domain Config**.

The optional string `lookupUrl` overrides the default endpoint:

```json
{
  "domains": ["aramburo.dev"],
  "lookupUrl": "http://srv-captain--selenium-service:8000/v1/icann/lookup"
}
```

Supply an absolute HTTP(S) endpoint without credentials, query parameters, or a fragment. The HTTP Request node adds an encoded `domain` query parameter. The existing internal Selenium/ICANN service and its HTML response contract remain the lookup source.

## Alerts and errors

The original alert rules and bot assignments are preserved:

| Days remaining | Action |
| --- | --- |
| Exactly 60 | Renewal reminder through `laziness_rocks_devops_bot`. |
| Exactly 30 | Renewal warning through the same bot. |
| Exactly 15 | Urgent warning through the same bot. |
| 10 or fewer | Critical warning through the same bot on every run. |
| All other values | No expiration notification. |
| Request or parsing failure | Error through `laziness_rocks_noficiations_bot`. |

Days remaining are `max(0, floor((expiration timestamp - check timestamp) / 86400000))`, preserving the original calculation. The parser accepts `YYYY-MM-DD HH:mm:ss UTC` and ISO UTC timestamps such as `2027-01-01T12:00:00Z` (with optional milliseconds), and rejects invalid dates. It reads a `span` whose classes include both `date` and `registry-expiration`, tolerating class order, additional attributes, and either quote style. The response can be raw HTML or a JSON envelope with an HTML string in `data`.

Expired domains have zero days remaining and receive an explicit expired-domain message. A domain expiring within 24 hours also has zero floored days, but is not marked expired until its expiration timestamp passes.

A 30-second lookup timeout, network failure, non-2xx response, missing expiration span, or invalid date produces a per-domain error and continues the loop after attempting its Telegram notification. Telegram sending failures also continue the loop and appear in the summary. Telegram credentials remain in n8n; the workflow reads only the destination chat from the table.

There is no persistent notification state. Manual runs can repeat alerts, critical alerts repeat every day, and exact 60/30/15-day reminders missed during downtime are not backfilled. **Manual Test** runs the normal notification path and can send real messages.

## Import and migration

1. Run [config.example.sql](../../database/domain-expiration/config.example.sql) against the existing automation database, or use the sample insert above and confirm `PERSONAL_TELEGRAM_CHAT_ID` is present.
2. Import **Domain expiration - Configured domains.json**.
3. Reselect the local `automation-db` PostgreSQL credential in **Get Domain Config**.
4. Reselect `laziness_rocks_devops_bot` in **Telegram - Expiration Alert** and `laziness_rocks_noficiations_bot` in **Telegram - Lookup Error**. The second name intentionally matches the existing credential's spelling.
5. Confirm the n8n worker can reach the internal lookup service and the schedule uses the intended time zone.
6. Deactivate the existing **Domain expiration - aramburo.dev**, **Domain expiration - laziness.rocks**, and **Domain expiration - inver** workflows in n8n. Replacing their repository exports does not deactivate deployed copies.
7. Run **Manual Test** and inspect **Run Summary**. It should report all three domains; investigate any lookup or notification failures.
8. Activate the replacement workflow.

The old per-domain exports have been replaced in this repository; their previous versions remain available in Git history. Database changes, n8n import, and activation are deployment steps and are not performed by editing these files.

## Execution output and validation

**Run Summary** returns `status` (`ok` or `partial_error`), `checkedCount`, `lookupErrorCount`, `expirationAlertsSent`, `errorNotificationsSent`, `notificationFailureCount`, `completedAt`, and per-domain `results`. Results include expiration timestamps, floored days, the alert level, request/parse errors, and notification status (`not_required`, `sent`, or `failed`). There is no daily success message. A handled failure can leave the n8n execution successful while the summary reports `partial_error`; database/configuration failures fail the execution directly.

Run the local checks with:

```bash
node --test workflows/domain-expiration/test-domain-expiration.cjs
```

These checks execute the exported Code nodes with mocked n8n inputs and route mixed outcomes through the exported graph. They cover JSON text config, normalization, alert boundaries, UTC/date parsing, lookup failures, failed Telegram delivery, and continuation to later domains. They do not connect to PostgreSQL, the lookup service, Telegram, or a live n8n instance; complete the import/manual check for runtime verification.

The loop uses n8n's documented [Loop Over Items](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.splitinbatches/) behavior with batch size 1. The lookup uses [HTTP Request](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/) full text responses so HTTP status and parsing errors can be handled separately.
