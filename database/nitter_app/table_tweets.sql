CREATE TABLE IF NOT EXISTS nitter_app.tweets (
    id SERIAL PRIMARY KEY,
    search_id INTEGER REFERENCES nitter_app.searches(id) ON DELETE CASCADE,
    nitter_guid TEXT NOT NULL,     -- The distinct ID from the RSS feed
    author_handle TEXT,            -- e.g., @GN_Carreteras
    content_html TEXT,             -- The tweet content
    tweet_link TEXT,
    published_at TIMESTAMP WITH TIME ZONE,
    ingested_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraint: A tweet is unique per search context. 
    -- (This allows the same tweet to be captured by two different search keywords if desired)
    CONSTRAINT unique_tweet_per_search UNIQUE (nitter_guid, search_id)
);

CREATE INDEX IF NOT EXISTS idx_nitter_guid ON nitter_app.tweets(nitter_guid);
CREATE INDEX IF NOT EXISTS idx_nitter_pub_date ON nitter_app.tweets(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_nitter_search_id ON nitter_app.tweets(search_id);

