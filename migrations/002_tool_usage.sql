-- Aggregate tool-usage counters backing the public /stats page. One row per
-- UTC day × dimension tuple — bounded cardinality, no per-user identity,
-- arguments, addresses, or amounts. Idempotent: safe to re-apply.

CREATE TABLE IF NOT EXISTS tool_usage_daily (
  day      DATE NOT NULL,
  tool     TEXT NOT NULL,
  kind     TEXT NOT NULL CHECK (kind IN ('read', 'write')),
  network  TEXT NOT NULL CHECK (network IN ('mainnet', 'testnet')),
  authed   BOOLEAN NOT NULL,
  ok       BOOLEAN NOT NULL,
  calls    BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (day, tool, kind, network, authed, ok)
);

CREATE INDEX IF NOT EXISTS tool_usage_daily_day_idx ON tool_usage_daily (day);
