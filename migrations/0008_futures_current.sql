CREATE TABLE futures_current (
 account_id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
 sync_id TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount>=0),
 rate INTEGER NOT NULL CHECK(rate>0), data_date TEXT NOT NULL,
 observed_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 FOREIGN KEY(account_id,user_id) REFERENCES accounts(id,user_id)
);
ALTER TABLE events ADD COLUMN futures_sync_id TEXT;
ALTER TABLE events ADD COLUMN futures_details_json TEXT;
CREATE UNIQUE INDEX futures_snapshot_once ON events(account_id,date,futures_sync_id) WHERE futures_sync_id IS NOT NULL;
CREATE TRIGGER check_futures_snapshot BEFORE INSERT ON events
WHEN NEW.futures_sync_id IS NOT NULL
BEGIN
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM futures_current WHERE account_id=NEW.account_id AND user_id=NEW.user_id
  AND sync_id=NEW.futures_sync_id AND amount=NEW.amount AND rate=NEW.rate
 ) THEN RAISE(ABORT, 'STALE_VERSION') END;
END;
