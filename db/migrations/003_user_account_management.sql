ALTER TABLE users
  ADD COLUMN account_status text NOT NULL DEFAULT 'active',
  ADD COLUMN suspended_until timestamptz,
  ADD COLUMN status_reason text,
  ADD COLUMN status_changed_at timestamptz,
  ADD COLUMN status_changed_by uuid REFERENCES users(id) ON DELETE SET NULL;

UPDATE users
SET account_status = CASE WHEN is_active THEN 'active' ELSE 'disabled' END;

ALTER TABLE users
  ADD CONSTRAINT users_account_status_check
    CHECK (account_status IN ('active', 'suspended', 'disabled')),
  ADD CONSTRAINT users_suspension_date_check
    CHECK (account_status <> 'suspended' OR suspended_until IS NOT NULL),
  ADD CONSTRAINT users_active_consistency_check
    CHECK (is_active = (account_status = 'active'));

CREATE INDEX users_account_status_idx ON users (account_status, suspended_until);
