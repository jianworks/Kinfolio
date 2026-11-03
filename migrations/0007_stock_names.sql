CREATE TABLE stock_names (
 market TEXT NOT NULL CHECK(market IN ('TWSE','TPEX')),
 symbol TEXT NOT NULL, name TEXT NOT NULL,
 fetched_at INTEGER NOT NULL, PRIMARY KEY(market,symbol)
);
