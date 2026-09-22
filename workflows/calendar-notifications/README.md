# Calendar Notifications

This directory contains the current Nextcloud → Redis → ntfy calendar notification workflows. Workflow-specific setup, operation, checkpoint notes, and future work live here. Repository-wide technical contracts and architectural decisions that affect AI-assisted maintenance live in [`../../AI_CONTEXT.md`](../../AI_CONTEXT.md).

## Current architecture

```text
Nextcloud / subscribed ICS calendars
        |
        v
Discover Nextcloud Calendars (every 15 minutes)
        |
        v
Redis calendar source registry
        |
        v
Scan Upcoming Events & Send Notifications (every minute)
        |
        +--> Redis event/day/reminder/change state
        +--> 30 / 10 / 1 minute ntfy reminders
        +--> event changed/deleted/cancelled ntfy notices
        +--> 21:00 next-day ntfy digest
```

The original concept separated event/cache maintenance from a completely mindless sender. The accepted implementation at this checkpoint instead keeps calendar-source discovery separate, while the every-minute scanner both reconciles event/reminder state and performs delivery. This avoids another workflow handoff while retaining Redis idempotency and recovery behavior.

## Workflows

### Calendar Notifications - Discover Nextcloud Calendars

Runs every 15 minutes by default. It:

- reads Nextcloud/calendar/Redis settings from `public.key_value_store` through the existing `automation-db` PostgreSQL credential;
- discovers the authenticated DAV principal and CalDAV calendar home;
- lists every calendar available to the configured user;
- distinguishes normal Nextcloud CalDAV calendars from external ICS subscriptions using the CalendarServer `source` property;
- writes the persistent last-known-good registry to `calendar-notifier:calendar-sources:v1` with **no Redis TTL**.

The currently confirmed working `NEXCLOUD_BASE_URL` is:

```text
https://cloud.idle.laziness.rocks
```

### Calendar Notifications - Scan Upcoming Events & Send Notifications

Runs every minute by default. It consumes the cached calendar source registry and:

- scans a bounded two-local-day horizon: today + tomorrow in `TIMEZONE`;
- uses bounded CalDAV `REPORT` queries for normal Nextcloud calendars and direct ICS fetches for external subscriptions;
- normalizes recurrence/time-zone data and extracts Google Meet / Microsoft Teams links;
- reconciles event keys, day snapshots and 30/10/1-minute reminder buckets in Redis;
- detects meaningful event changes and deletions/cancellations after successful authoritative scans;
- preserves previous state if an individual calendar fetch fails, avoiding false deletion notices;
- sends due reminders, event-change notices and deletion/cancellation notices through ntfy;
- sends a next-day digest at or after 21:00 in `TIMEZONE`;
- uses Redis sent markers and short atomic delivery claims to suppress duplicate sends across retries and overlapping runs.

## Confirmed deployment assumptions

- n8n: self-hosted 2.7.3.
- `NEXCLOUD_BASE_URL`: `https://cloud.idle.laziness.rocks`.
- Configuration/secrets are read from `public.key_value_store` using the `automation-db` credential.
- Redis uses the n8n credential `Redis - shared`, aligned with the `REDIS_*` key-value-store entries.
- Calendar-source discovery uses Code-node DAV calls because the target n8n version does not provide the needed WebDAV methods in the normal HTTP Request node.
- Code nodes must not depend on the global WHATWG `URL` constructor in this environment; discovery uses string-based URL parsing/resolution.

## Required key-value-store entries

Nextcloud/runtime:

```text
NEXCLOUD_BASE_URL
NEXCLOUD_CALENDAR_USER
NEXCLOUD_CALENDAR_PASSWORD
TIMEZONE
```

Redis:

```text
REDIS_HOST
REDIS_PORT
REDIS_PASSWORD
REDIS_DATABASE
```

ntfy:

```text
NOTIFICATIONS_USER
NOTIFICATIONS_PASSWORD
NOTIFICATIONS_BASE_URL
NOTIFICATIONS_CALENDAR_CHANNEL_TOPIC
```

No service secrets should be hard-coded into the workflow exports.

## n8n credentials

The exports currently reference these credential display names:

- PostgreSQL: `automation-db`
- Redis: `Redis - shared`

After import, reselect the local credentials if their imported IDs are stale. The Redis credential must point to the same Redis database described by the `REDIS_*` entries in `public.key_value_store`.

## Import / activation order

1. Import **Calendar Notifications - Discover Nextcloud Calendars**.
2. Reselect `automation-db` and `Redis - shared` if required.
3. Run **Manual Test** once and confirm `calendar-notifier:calendar-sources:v1` exists in Redis.
4. Import **Calendar Notifications - Scan Upcoming Events & Send Notifications**.
5. Reselect `automation-db` and `Redis - shared` if required.
6. Run its **Manual Test** and inspect **Scan & Delivery Result**.
7. Activate both workflows.

The discovery workflow should normally stay on its default 15-minute cadence. The scanner should normally stay on its default one-minute cadence. Change those frequencies only on their schedule-trigger nodes.

## Important Redis keys

```text
calendar-notifier:calendar-sources:v1
calendar-notifier:event:v1:<calendarId>:<occurrenceId>
calendar-notifier:events:day:v1:<YYYY-MM-DD>:<calendarId>
calendar-notifier:reminders:v1:<offsetMinutes>:<UTC-minute>:<calendarId>
calendar-notifier:scan-state:v1:<YYYY-MM-DD>
calendar-notifier:message:v1:<calendarId>:<messageId>
calendar-notifier:sent:v1:reminder:<offsetMinutes>:<UTC-minute>:<eventKey>
calendar-notifier:sent:v1:change:<messageId>
calendar-notifier:sent:v1:digest:<YYYY-MM-DD>
calendar-notifier:claim:v1:<delivery identity>
```

The source registry is persistent. Scheduling/message keys use bounded lifetimes appropriate to their function, while sent markers prevent duplicate notification delivery.

## Implemented behavior at this checkpoint

Checkpoint date: **2026-09-22**.

- all accessible Nextcloud calendars are discovered;
- external subscribed ICS calendars are detected from CalDAV `calendarserver.org/ns/source`;
- calendar source registry is persistent in Redis and refreshed every 15 minutes;
- event scanner covers today + tomorrow in configured `TIMEZONE`;
- event time zones are respected and converted to the configured notification zone;
- recurring event instances and common recurrence exceptions are normalized within the bounded scan window;
- Google Meet and Microsoft Teams links are extracted and included in notifications;
- reminders are scheduled for 30, 10 and 1 minute before meetings;
- deleted/cancelled events and meaningful meeting changes generate notification message types;
- temporary calendar-fetch failures preserve prior state instead of causing false deletions;
- Redis sent markers plus short atomic claims prevent duplicate deliveries;
- next-day digest is sent at/after 21:00 local time and guarded by a per-target-day Redis sent marker.

The canonical workflow files are:

- `Calendar Notifications - Discover Nextcloud Calendars.json`
- `Calendar Notifications - Scan Upcoming Events & Send Notifications.json`
- this `README.md`

Intermediate `_v1` / `_v2` / `_v3` / `_v4` development exports are not canonical repository files. Future changes should start from the exports in this directory.

## Future work

Potential follow-ups include production observation of reminder/digest timing, notification presentation tweaks, Redis retention tuning, and—only if operationally useful—splitting delivery into a dedicated sender workflow later.
