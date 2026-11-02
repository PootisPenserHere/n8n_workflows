-- key_value_store.data is TEXT. Validate the JSON, then serialize it back to text.
-- Re-running this upsert replaces the complete configured domain list.
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
    'Domain expiration monitor: serialized JSON domain list and optional lookupUrl'
)
ON CONFLICT (name) DO UPDATE
SET data = EXCLUDED.data,
    description = EXCLUDED.description;

-- Reuse the shared destination. Seed the old workflows' chat only if absent.
INSERT INTO public.key_value_store (name, data, description)
VALUES (
    'PERSONAL_TELEGRAM_CHAT_ID',
    '1234567890',
    'Default Telegram chat for personal notifications'
)
ON CONFLICT (name) DO NOTHING;
