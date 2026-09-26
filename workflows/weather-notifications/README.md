# Weather Notifications

This directory contains the WeatherAPI → Redis → ntfy weather notification workflow. Workflow-specific setup, operation, Redis behavior, and checkpoint notes live here. Repository-wide technical contracts and architectural decisions that affect AI-assisted maintenance live in [`../../AI_CONTEXT.md`](../../AI_CONTEXT.md).

## Current architecture

```text
Schedule Trigger (every 5 minutes)
        |
        v
Read config from public.key_value_store
        |
        +--> WeatherAPI current.json
        |       |
        |       +--> routine condition -> no notification
        |       |
        |       +--> reportable condition
        |               |
        |               +--> Redis marker exists -> refresh 15-minute TTL
        |               |
        |               +--> no marker -> ntfy weather alert -> write marker
        |
        +--> at/after 23:00 in TIMEZONE
                |
                +--> daily target-date marker exists -> skip
                |
                +--> no marker -> WeatherAPI forecast.json?days=2
                                -> build tomorrow summary
                                -> ntfy daily weather report
                                -> write target-date marker

WeatherAPI current/forecast failures
        -> Redis-deduplicated ntfy infrastructure alert
```

## Workflow

### Weather Notifications - WeatherAPI + ntfy

Runs every five minutes. It:

- reads WeatherAPI, location, time-zone, ntfy, and topic settings from `public.key_value_store` using the existing `automation-db` PostgreSQL credential;
- fetches the current weather for the configured latitude/longitude;
- treats WeatherAPI condition codes `1000`, `1003`, `1006`, `1009`, `1030`, `1135`, and `1147` as suppressed for current-condition alerts; the added codes are Mist, Fog, and Freezing fog;
- treats any other numeric WeatherAPI condition code as reportable;
- uses a Redis marker per active condition code to avoid repeatedly notifying while that condition remains active;
- refreshes an existing active-condition marker to a 15-minute TTL on every matching five-minute check;
- sends a weather alert through ntfy before creating the marker for a newly observed reportable condition;
- sends WeatherAPI current/forecast failures to the infrastructure ntfy topic, also deduplicated with 15-minute Redis markers;
- at/after 23:00 in the configured `TIMEZONE`, sends one report for the next local calendar day;
- guards that daily report with a Redis marker keyed by the target date and writes the marker only after ntfy succeeds.

## Required key-value-store entries

WeatherAPI/location:

```text
WEATHERAPI_API_KEY
SCHOOL_LATITUDE
SCHOOL_LONGITUDE
TIMEZONE
```

ntfy:

```text
NOTIFICATIONS_BASE_URL
NOTIFICATIONS_WEATHER_TOPIC
NOTIFICATIONS_INFRA_ISSUES_TOPIC
NOTIFICATIONS_USER
NOTIFICATIONS_PASSWORD
```

`NOTIFICATIONS_USER` and `NOTIFICATIONS_PASSWORD` are optional as a pair. If one is configured, the other must also be configured. The remaining entries above are required by the workflow.

No WeatherAPI key, ntfy password, or fixed coordinates should be hard-coded into the workflow export.

## n8n credentials

The export currently references these credential display names:

- PostgreSQL: `automation-db`
- Redis: `Redis - shared`

After import, reselect the local credentials if their imported IDs are stale. The Redis credential should point to the shared Redis instance/database used by the rest of this repository.

The HTTP calls themselves are performed from Code nodes with `this.helpers.httpRequest`; WeatherAPI and ntfy secrets are read from the key-value store instead of being stored in n8n HTTP credentials.

## Current-condition classification

The quiet/routine WeatherAPI condition-code set is:

```text
1000  Sunny / Clear
1003  Partly Cloudy
1006  Cloudy
1009  Overcast
1030  Mist
1135  Fog
1147  Freezing fog
```

All other numeric condition codes are currently considered reportable. Fog/mist are intentionally suppressed because they are too noisy for this notification use case. This is intentionally simple and code-driven: future changes to what counts as noteworthy should update both the `Classify Current Conditions` Code node and this documentation/`AI_CONTEXT.md`.

A current-condition notification includes, when present:

- WeatherAPI condition text;
- temperature and feels-like temperature;
- precipitation;
- humidity;
- wind direction/speed and gusts;
- visibility;
- observation timestamp;
- WeatherAPI condition image as ntfy `icon` and external `attach`.

## Redis keys and TTL behavior

Current-condition marker:

```text
weather-notifier:active:v1:condition:<WeatherAPI condition code>
```

TTL: **15 minutes**.

Behavior:

1. A newly observed reportable condition with no marker is sent to ntfy.
2. Only after ntfy succeeds is the condition marker written.
3. On each later five-minute check where the same condition remains reportable, the marker is rewritten and its TTL returns to 15 minutes.
4. If the condition disappears long enough for the marker to expire, a later recurrence can notify again.

WeatherAPI failure markers:

```text
weather-notifier:active:v1:api-error:current
weather-notifier:active:v1:api-error:forecast
```

TTL: **15 minutes** each. Repeated failures refresh the corresponding marker instead of sending another infrastructure notification. A successful call deletes that endpoint's active error marker.

Daily-report marker:

```text
weather-notifier:sent:v1:daily:<tomorrow YYYY-MM-DD>
```

TTL: **3 days**. The key is based on the day being forecast, not the execution date/time.

## Daily next-day report

On every five-minute execution, the workflow computes local time using the configured IANA `TIMEZONE`. When the local hour is `23` or later, it checks the next-day marker. If that target date has not yet been sent, it requests:

```text
GET https://api.weatherapi.com/v1/forecast.json
  ?q=<latitude,longitude>
  &days=2
  &aqi=no
  &alerts=no
```

The workflow selects the forecast matching the computed next-local-day date, with positional fallbacks if necessary.

The report contains the daily condition plus available minimum, maximum, and average temperature, rain/snow chance, total precipitation, max wind, and average humidity. If the daily condition is Mist, Fog, or Freezing fog, that condition label/icon is omitted. It lists every significant hourly period returned by WeatherAPI rather than truncating the list.

An hourly period is considered significant when any of these is true:

- rain chance is at least 30%;
- snow chance is at least 20%;
- forecast precipitation is greater than 0 mm;
- the WeatherAPI condition code is not one of the four base routine codes above and is not Mist, Fog, or Freezing fog.

Mist/Fog/Freezing-fog hours are not significant solely because of that condition. If the same hour independently meets the rain, snow, or precipitation threshold, the hour remains in the report but its fog/mist condition label is omitted so useful precipitation timing is not lost. Hourly details can include time, condition (when not suppressed), temperature, rain/snow chance, precipitation, and gusts when gust speed is at least 30 km/h. If no significant hours are found, the report explicitly says so.

The daily WeatherAPI condition image is passed to ntfy as both `icon` and external `attach` when WeatherAPI returns an icon URL.

## ntfy delivery behavior

Notifications are posted as JSON to `NOTIFICATIONS_BASE_URL`. The workflow sets the ntfy `topic` in the JSON body rather than appending the topic to the URL.

When both ntfy username and password are configured, the Code nodes send HTTP Basic authentication. Weather alerts/daily reports use `NOTIFICATIONS_WEATHER_TOPIC`; WeatherAPI failures use `NOTIFICATIONS_INFRA_ISSUES_TOPIC`.

Redis sent/active markers are written only after a successful 2xx ntfy response. This lets a later workflow execution retry when ntfy delivery fails.

## Import and smoke-test procedure

1. Import `Weather Notifications - WeatherAPI + ntfy.json`.
2. Reselect `automation-db` and `Redis - shared` if n8n reports missing/stale credential references.
3. Confirm the required `public.key_value_store` entries exist.
4. Run **Manual Test** once.
5. Inspect **Format & Validate Config** for the expected coordinate/time-zone/topic values without exposing secrets in logs or documentation.
6. Inspect **Fetch Current Weather** and confirm WeatherAPI returns `success: true`.
7. For normal weather, verify the execution exits through the non-reportable branch without an ntfy alert.
8. If testing the alert branch, use a controlled temporary classification/config change rather than waiting for hazardous weather; restore the canonical quiet-code set afterward.
9. Verify Redis keys/TTLs after a test alert/error and verify duplicate executions refresh the marker instead of sending again.
10. Verify the daily path with a controlled temporary clock/due-condition change if needed; restore the canonical `>= 23` logic afterward.
11. Activate the workflow.

## Implemented behavior at this checkpoint

Checkpoint date: **2026-09-25**.

- five-minute schedule plus manual test trigger;
- configuration loaded from `public.key_value_store`;
- current WeatherAPI lookup for the configured coordinates;
- current-condition suppression for codes `1000`, `1003`, `1006`, `1009`, `1030` (Mist), `1135` (Fog), and `1147` (Freezing fog);
- Redis active-condition suppression with 15-minute rolling TTL;
- WeatherAPI failure notices routed to the infrastructure ntfy topic with the same rolling suppression pattern;
- once-per-target-day next-day report at/after 23:00 local time;
- hourly significant-weather extraction for the daily report, with fog/mist removed as standalone report reasons and all relevant forecast hours included;
- WeatherAPI condition icons included in ntfy when available;
- ntfy success required before writing condition/daily/error markers.

The canonical workflow file is:

- `Weather Notifications - WeatherAPI + ntfy.json`

Future changes should start from the export in this directory and update this README plus the root `AI_CONTEXT.md` whenever behavior/contracts change.

## Future work

Potential follow-ups include tuning the routine/reportable condition set, making alert thresholds configurable, separating different adverse condition families into different priorities/tags, and production observation of marker TTL/daily-report timing.
