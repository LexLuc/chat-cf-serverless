DROP TABLE IF EXISTS user_account;
CREATE TABLE IF NOT EXISTS user_account (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL,
    hashed_password TEXT NOT NULL,
    yob INTEGER CHECK (yob >= 1900) NOT NULL,
    is_vip BOOLEAN DEFAULT 1,
    role TEXT DEFAULT 'customer',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    preferred_voice TEXT DEFAULT 'nova' NOT NULL,
    cached_story_count INTEGER CHECK (cached_story_count >= 0) NOT NULL
);


INSERT INTO user_account (
    id,
    email,
    username,
    hashed_password,
    yob,
    role,
    preferred_voice,
    cached_story_count
) VALUES (
    0,
    'admin@aoxin.ai',
    'aoxin-administrator',
    'ui3ga4MqRIkMI7A1hvgdKhaaPJJNnLZRLZZ2S2RDtll++FqAGWvYKLpaDJXFhcoo', -- aoxin-ai
    2024,
    'admin',
    'echo',
    5
);
