ALTER TABLE tickets
  ALTER COLUMN organization_id DROP NOT NULL;

ALTER TABLE attachments
  ALTER COLUMN organization_id DROP NOT NULL;