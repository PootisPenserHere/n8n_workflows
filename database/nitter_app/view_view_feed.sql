CREATE OR REPLACE VIEW nitter_app.view_feed AS
SELECT 
    t.id,
    t.published_at,
    t.author_handle,
    t.content_html,
    t.tweet_link,
    s.search_query,
    s.host_name,
    s.filters
FROM nitter_app.tweets t
JOIN nitter_app.searches s ON t.search_id = s.id
ORDER BY t.published_at DESC;
