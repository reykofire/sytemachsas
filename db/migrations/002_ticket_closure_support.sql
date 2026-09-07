ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS closure_cause text,
  ADD COLUMN IF NOT EXISTS closure_note text,
  ADD COLUMN IF NOT EXISTS closed_by uuid REFERENCES users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tickets_closure_cause_check') THEN
    ALTER TABLE tickets ADD CONSTRAINT tickets_closure_cause_check CHECK (
      closure_cause IS NULL OR closure_cause IN (
        'hardware_failure', 'software_issue', 'configuration', 'user_guidance',
        'preventive_maintenance', 'parts_replacement', 'network_issue', 'security_incident', 'other'
      )
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tickets_closed_support_check') THEN
    ALTER TABLE tickets ADD CONSTRAINT tickets_closed_support_check CHECK (
      status <> 'closed' OR (
        closure_cause IS NOT NULL AND closure_note IS NOT NULL
        AND char_length(btrim(closure_note)) > 30 AND closed_by IS NOT NULL
      )
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS attachments_comment_idx ON attachments (comment_id, created_at);
