PRAGMA foreign_keys = ON;
CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL);
CREATE TABLE revisions (user_id TEXT PRIMARY KEY REFERENCES users(id), version INTEGER NOT NULL DEFAULT 0);
CREATE TABLE mutations (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expected_version INTEGER NOT NULL);
CREATE TRIGGER check_revision BEFORE INSERT ON mutations BEGIN
 SELECT CASE WHEN COALESCE((SELECT version FROM revisions WHERE user_id=NEW.user_id),-1) != NEW.expected_version THEN RAISE(ABORT, 'STALE_VERSION') END;
 UPDATE revisions SET version=version+1 WHERE user_id=NEW.user_id;
END;
CREATE TABLE holders (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, UNIQUE(id,user_id));
CREATE TABLE accounts (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), holder_id TEXT NOT NULL,
 name TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('股票','期貨','美股','未上市公司')),
 currency TEXT NOT NULL CHECK(currency IN ('TWD','USD','JPY')), created_date TEXT NOT NULL,
 FOREIGN KEY(holder_id,user_id) REFERENCES holders(id,user_id), UNIQUE(id,user_id)
);
CREATE TABLE events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, account_id TEXT NOT NULL,
 date TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('opening','valuation','deposit','withdrawal','transfer_in','transfer_out')),
 amount INTEGER NOT NULL, cost_delta INTEGER NOT NULL DEFAULT 0, cost_twd_delta INTEGER NOT NULL DEFAULT 0,
 rate INTEGER NOT NULL CHECK(rate>0), note TEXT NOT NULL DEFAULT '', transfer_id TEXT,
 FOREIGN KEY(account_id,user_id) REFERENCES accounts(id,user_id)
);
CREATE INDEX events_account_date ON events(user_id,account_id,date,id);
CREATE TABLE transfers (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), date TEXT NOT NULL, request_key TEXT NOT NULL, UNIQUE(user_id,request_key));
CREATE TABLE loans (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, holder_id TEXT NOT NULL, name TEXT NOT NULL,
 currency TEXT NOT NULL CHECK(currency IN ('TWD','USD','JPY')), annual_rate REAL NOT NULL CHECK(annual_rate>=0),
 FOREIGN KEY(holder_id,user_id) REFERENCES holders(id,user_id), UNIQUE(id,user_id)
);
CREATE TABLE loan_balances (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, loan_id TEXT NOT NULL, date TEXT NOT NULL,
 balance INTEGER NOT NULL CHECK(balance>=0), rate INTEGER NOT NULL CHECK(rate>0), note TEXT NOT NULL DEFAULT '',
 FOREIGN KEY(loan_id,user_id) REFERENCES loans(id,user_id)
);
CREATE INDEX loan_dates ON loan_balances(user_id,loan_id,date,id);
CREATE TABLE goals (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, holder_id TEXT NOT NULL, name TEXT NOT NULL,
 target INTEGER NOT NULL CHECK(target>0), date TEXT NOT NULL, basis TEXT NOT NULL CHECK(basis IN ('assets','net')),
 FOREIGN KEY(holder_id,user_id) REFERENCES holders(id,user_id)
);
