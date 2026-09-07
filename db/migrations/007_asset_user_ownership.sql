ALTER TABLE assets
  ADD COLUMN owner_user_id uuid REFERENCES users(id) ON DELETE RESTRICT;

CREATE INDEX assets_owner_user_idx ON assets (owner_user_id, status);

CREATE TABLE asset_owner_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  previous_owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
  new_owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
  previous_owner_name text,
  new_owner_name text NOT NULL,
  changed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX asset_owner_history_asset_idx ON asset_owner_history (asset_id, changed_at DESC);