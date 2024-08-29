DROP TABLE IF EXISTS user_account;
CREATE TABLE user_account (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    hashed_password TEXT NOT NULL,
    yob INTEGER CHECK (yob >= 1900) NOT NULL,
    email TEXT UNIQUE,
    is_active BOOLEAN DEFAULT true,
    auth_code TEXT,
    role TEXT DEFAULT 'customer',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    preferred_voice TEXT DEFAULT 'nova' NOT NULL,
    cached_story_count INTEGER CHECK (cached_story_count >= 0) NOT NULL
);


INSERT INTO user_account (
    id,
    username,
    hashed_password,
    yob,
    preferred_voice,
    cached_story_count
) VALUES (
    0,
    'Lex',
    'hahaha',
    2024,
    'echo',
    5
);
