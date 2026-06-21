CREATE TABLE IF NOT EXISTS nitter_app.searches (
    id SERIAL PRIMARY KEY,
    full_url TEXT NOT NULL UNIQUE, -- Used to identify the workflow copy
    host_name TEXT NOT NULL,       -- extracted host (e.g., nitter.idle.laziness.rocks)
    search_query TEXT NOT NULL,    -- extracted query (e.g., culiacan)
    filters JSONB DEFAULT '{}'::jsonb, -- extracted params (e.g., e-replies: on)
    last_run_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
