ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS organization_type text NOT NULL DEFAULT 'client';

UPDATE organizations
SET organization_type = 'internal'
WHERE lower(email) = 'soporte@hardsystem.local' OR name = 'HardSystem';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizations_type_check') THEN
    ALTER TABLE organizations ADD CONSTRAINT organizations_type_check
      CHECK (organization_type IN ('client', 'internal'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS organizations_type_active_idx
  ON organizations (organization_type, is_active, name);
