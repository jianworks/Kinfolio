CREATE TABLE cash_plans (
 user_id TEXT PRIMARY KEY REFERENCES users(id),
 payload TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
