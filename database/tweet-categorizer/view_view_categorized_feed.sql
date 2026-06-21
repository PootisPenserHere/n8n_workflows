CREATE OR REPLACE VIEW nitter_app.view_categorized_feed AS
SELECT 
    t.id AS tweet_id,
    t.content_html,
    t.author_handle,
    t.published_at,
    m.model_name,
    c.language_result,
    c.categories,
    c.created_at AS categorized_at
FROM nitter_app.tweets t
JOIN nitter_app.tweet_categorizations c ON t.id = c.tweet_id
JOIN nitter_app.llm_models m ON c.model_id = m.id
ORDER BY t.published_at DESC;
