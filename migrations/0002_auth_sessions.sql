CREATE TABLE oauth_requests (
 id TEXT PRIMARY KEY,
 nonce TEXT NOT NULL,
 verifier TEXT NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX oauth_expiry ON oauth_requests(expires_at);
CREATE TABLE sessions (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 expires_at INTEGER NOT NULL
);
CREATE INDEX session_expiry ON sessions(expires_at);
