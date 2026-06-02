-- monad-mcp initial schema. Runs idempotently: safe to apply on an empty DB
-- or one that's already been migrated.

CREATE TABLE IF NOT EXISTS stored_requests (
  id              UUID PRIMARY KEY,
  user_id         TEXT NOT NULL,
  network         TEXT NOT NULL CHECK (network IN ('mainnet', 'testnet')),
  wallet_address  TEXT NOT NULL,
  summary         TEXT NOT NULL,
  call_to         TEXT NOT NULL,
  call_value      NUMERIC NOT NULL,
  call_data       TEXT NOT NULL,
  simulation      JSONB,
  plugin_context  JSONB,
  status          TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','expired')),
  tx_hash         TEXT,
  rejection_reason TEXT,
  created_at      BIGINT NOT NULL,
  expires_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS stored_requests_user_idx ON stored_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS stored_requests_status_idx ON stored_requests (status, expires_at);

CREATE TABLE IF NOT EXISTS session_grants (
  id                 UUID PRIMARY KEY,
  user_id            TEXT NOT NULL,
  wallet_address     TEXT NOT NULL,
  network            TEXT NOT NULL CHECK (network IN ('mainnet','testnet')),
  label              TEXT NOT NULL,
  spend_cap_wei      NUMERIC NOT NULL,
  spent_wei          NUMERIC NOT NULL DEFAULT 0,
  allowed_targets    JSONB NOT NULL DEFAULT '[]',
  allowed_selectors  JSONB NOT NULL DEFAULT '[]',
  status             TEXT NOT NULL CHECK (status IN ('pending','active','revoked','expired','depleted')),
  approval_request_id UUID,
  -- Optional Privy policy mirror for defense-in-depth.
  privy_policy_id    TEXT,
  created_at         BIGINT NOT NULL,
  approved_at        BIGINT,
  expires_at         BIGINT NOT NULL,
  revoked_at         BIGINT,
  updated_at         BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS session_grants_user_idx ON session_grants (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS session_grants_status_idx ON session_grants (user_id, status, expires_at);
