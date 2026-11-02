-- key_value_store.data is TEXT. Validate the JSON, then serialize it back to text.
-- Re-running this upsert replaces the complete configured domain list.
-- PLAYWRIGHT_BASE_URL must already contain your Docker service address and port
-- (for example http://playwright-api:8080); the workflow appends /render/actions.
-- Reuse existing ntfy config: NOTIFICATIONS_BASE_URL, NOTIFICATIONS_INFRA_ISSUES_TOPIC,
-- and optional NOTIFICATIONS_USER + NOTIFICATIONS_PASSWORD (both or neither).
INSERT INTO public.key_value_store (name, data, description)
VALUES (
    'DOMAIN_EXPIRATION_CONFIG',
    $domain_config$
    {
      "domains": [
        "laziness.rocks"
      ]
    }
    $domain_config$::jsonb::text,
    'Domain expiration monitor: serialized JSON domain list'
)
ON CONFLICT (name) DO UPDATE
SET data = EXCLUDED.data,
    description = EXCLUDED.description;
