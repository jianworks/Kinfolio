CREATE TABLE watchlist (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 market TEXT NOT NULL CHECK(market IN ('TWSE','TPEX')), symbol TEXT NOT NULL,
 name TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
 UNIQUE(user_id,market,symbol)
);
CREATE INDEX watchlist_user ON watchlist(user_id);
CREATE TABLE stock_history (
 market TEXT NOT NULL, symbol TEXT NOT NULL, payload TEXT,
 target_date TEXT, last_attempt INTEGER NOT NULL DEFAULT 0,
 error TEXT NOT NULL DEFAULT '', PRIMARY KEY(market,symbol)
);
