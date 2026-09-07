ALTER TABLE orders
  ADD COLUMN payment_provider text,
  ADD COLUMN payment_status text,
  ADD COLUMN payment_reference text,
  ADD COLUMN payment_currency text,
  ADD COLUMN payment_amount numeric(12,2),
  ADD COLUMN exchange_rate numeric(14,4);

CREATE TABLE payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (provider IN ('paypal')),
  provider_order_id text UNIQUE,
  provider_capture_id text UNIQUE,
  status text NOT NULL DEFAULT 'creating'
    CHECK (status IN ('creating', 'created', 'completed', 'captured_review', 'failed')),
  subtotal_cop bigint NOT NULL CHECK (subtotal_cop >= 0),
  shipping_cop bigint NOT NULL CHECK (shipping_cop >= 0),
  total_cop bigint NOT NULL CHECK (total_cop >= 0),
  payment_currency text NOT NULL,
  payment_amount numeric(12,2) NOT NULL CHECK (payment_amount > 0),
  exchange_rate numeric(14,4) NOT NULL CHECK (exchange_rate > 0),
  cart_snapshot jsonb NOT NULL,
  order_id uuid UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payment_attempts_user_idx ON payment_attempts(user_id, created_at DESC);