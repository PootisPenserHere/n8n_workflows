CREATE TABLE key_value_store (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL,
    data TEXT,
    description TEXT
);
