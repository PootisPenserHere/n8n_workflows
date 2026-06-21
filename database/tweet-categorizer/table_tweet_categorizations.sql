CREATE TABLE IF NOT EXISTS nitter_app.tweet_categorizations (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT gen_random_uuid(),
    tweet_id INTEGER REFERENCES nitter_app.tweets(id) ON DELETE CASCADE,
    model_id INTEGER REFERENCES nitter_app.llm_models(id) ON DELETE CASCADE,
    language_result TEXT,
    categories JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT unique_categorization_per_model UNIQUE (tweet_id, model_id)
);

CREATE INDEX IF NOT EXISTS idx_cat_tweet_id ON nitter_app.tweet_categorizations(tweet_id);
CREATE INDEX IF NOT EXISTS idx_cat_model_id ON nitter_app.tweet_categorizations(model_id);
