CREATE TABLE portfolios (
 account_id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL,
 mode TEXT NOT NULL CHECK(mode IN ('manual','holdings')),
 cash INTEGER NOT NULL CHECK(cash>=0),
 rate INTEGER NOT NULL CHECK(rate>0),
 data_date TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 FOREIGN KEY(account_id,user_id) REFERENCES accounts(id,user_id)
);
CREATE TABLE holdings (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, account_id TEXT NOT NULL,
 market TEXT NOT NULL CHECK(market IN ('TWSE','TPEX','US')),
 symbol TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>0),
 manual_price INTEGER CHECK(manual_price>0), manual_date TEXT,
 UNIQUE(account_id,market,symbol),
 FOREIGN KEY(account_id,user_id) REFERENCES accounts(id,user_id)
);
CREATE INDEX holdings_user ON holdings(user_id,account_id);
CREATE TABLE quote_cache (
 market TEXT NOT NULL, symbol TEXT NOT NULL, price INTEGER, price_date TEXT,
 source TEXT, fetched_at INTEGER NOT NULL DEFAULT 0,
 last_attempt INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '',
 PRIMARY KEY(market,symbol)
);
CREATE TABLE quote_limits (provider TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(provider,day));
CREATE TABLE portfolio_estimates (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, account_id TEXT NOT NULL,
 version INTEGER NOT NULL, amount INTEGER, rate INTEGER NOT NULL,
 complete INTEGER NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 details_json TEXT NOT NULL,
 FOREIGN KEY(account_id,user_id) REFERENCES accounts(id,user_id)
);
CREATE INDEX estimates_user ON portfolio_estimates(user_id,expires_at);
ALTER TABLE events ADD COLUMN portfolio_estimate_id TEXT REFERENCES portfolio_estimates(id);
CREATE UNIQUE INDEX event_portfolio_estimate ON events(portfolio_estimate_id);
CREATE VIEW portfolio_snapshots AS
 SELECT e.id AS event_id,r.id,r.user_id,r.account_id,r.amount,r.rate,r.created_at,r.details_json
 FROM events e JOIN portfolio_estimates r ON e.portfolio_estimate_id=r.id;
