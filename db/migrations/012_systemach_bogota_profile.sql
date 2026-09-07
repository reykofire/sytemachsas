-- Systemach's published contact details; existing customer records stay intact.
ALTER TABLE organizations ALTER COLUMN city SET DEFAULT 'Bogotá';

UPDATE organizations
SET name = 'SYSTEMACH S.A.S.',
    city = 'Bogotá',
    address = 'Calle 2 # 93-27, Kennedy, Primavera, Bogotá, Colombia',
    phone = '+57 310 268 1145',
    email = 'systemachsas@gmail.com',
    updated_at = now()
WHERE organization_type = 'internal'
  AND name IN ('HardSystem', 'Systemach', 'SYSTEMACH S.A.S.');
