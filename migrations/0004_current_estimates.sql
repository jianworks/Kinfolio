CREATE TABLE portfolio_current (
 account_id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL,
 composition_key TEXT NOT NULL,
 details_json TEXT,
 checked_at INTEGER NOT NULL,
 updated_at INTEGER,
 error TEXT NOT NULL DEFAULT '',
 FOREIGN KEY(account_id,user_id) REFERENCES accounts(id,user_id)
);
CREATE INDEX current_estimates_user ON portfolio_current(user_id);
-- Bootstrap from prior complete computations. The application validates the composition
-- before using a legacy row, so an old holding quantity or cash balance cannot leak through.
INSERT INTO portfolio_current(account_id,user_id,composition_key,details_json,checked_at,updated_at)
SELECT r.account_id,r.user_id,'',r.details_json,r.created_at*1000,r.created_at*1000
FROM portfolio_estimates r JOIN portfolios p ON p.account_id=r.account_id
WHERE r.complete=1 AND p.mode='holdings' AND NOT EXISTS (
 SELECT 1 FROM portfolio_estimates newer WHERE newer.account_id=r.account_id AND newer.complete=1
 AND (newer.created_at>r.created_at OR (newer.created_at=r.created_at AND newer.id>r.id))
);
