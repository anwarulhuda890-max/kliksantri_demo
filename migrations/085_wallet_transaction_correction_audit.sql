-- 085: Immutable audit history for safe Wallet manual-topup corrections.
-- The original wallet transaction is intentionally not referenced by FK so
-- delete audits survive a hard delete from the user-facing ledger.

CREATE TABLE IF NOT EXISTS wallet_transaction_correction_audits (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  unit_id INTEGER NOT NULL,
  wallet_account_id BIGINT NOT NULL,
  santri_id INTEGER NOT NULL,
  original_transaction_id BIGINT NOT NULL,
  action VARCHAR(10) NOT NULL,
  original_type VARCHAR(40) NOT NULL,
  original_direction VARCHAR(10) NOT NULL,
  original_nominal BIGINT NOT NULL,
  new_nominal BIGINT,
  balance_delta BIGINT NOT NULL,
  resulting_balance BIGINT NOT NULL,
  original_source VARCHAR(80) NOT NULL,
  original_reference_type VARCHAR(80),
  original_reference_id VARCHAR(255),
  original_idempotency_key VARCHAR(255) NOT NULL,
  original_created_at TIMESTAMPTZ NOT NULL,
  actor_user_id INTEGER,
  reason TEXT NOT NULL,
  request_id VARCHAR(180) NOT NULL,
  before_snapshot JSONB NOT NULL,
  after_snapshot JSONB,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT wallet_correction_action_check CHECK (action IN ('edit', 'delete')),
  CONSTRAINT wallet_correction_original_nominal_check CHECK (original_nominal > 0),
  CONSTRAINT wallet_correction_new_nominal_check CHECK (new_nominal IS NULL OR new_nominal > 0),
  CONSTRAINT wallet_correction_resulting_balance_check CHECK (resulting_balance >= 0),
  CONSTRAINT wallet_correction_reason_check CHECK (CHAR_LENGTH(BTRIM(reason)) BETWEEN 5 AND 500),
  CONSTRAINT wallet_correction_request_check CHECK (CHAR_LENGTH(BTRIM(request_id)) BETWEEN 8 AND 180),
  CONSTRAINT wallet_correction_delete_timestamp_check CHECK (
    (action = 'delete' AND deleted_at IS NOT NULL AND new_nominal IS NULL)
    OR (action = 'edit' AND deleted_at IS NULL AND new_nominal IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS wallet_correction_tenant_action_request_unique
  ON wallet_transaction_correction_audits (tenant_id, action, request_id);
CREATE INDEX IF NOT EXISTS wallet_correction_tenant_unit_created_idx
  ON wallet_transaction_correction_audits (tenant_id, unit_id, created_at DESC);
CREATE INDEX IF NOT EXISTS wallet_correction_original_transaction_idx
  ON wallet_transaction_correction_audits (tenant_id, original_transaction_id, created_at DESC);
CREATE INDEX IF NOT EXISTS wallet_correction_account_idx
  ON wallet_transaction_correction_audits (wallet_account_id, created_at DESC);

