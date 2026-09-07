UPDATE organizations
SET name = 'Empresa de demostración', updated_at = now()
WHERE name = 'Cliente DEV';

UPDATE users
SET full_name = 'Cliente de demostración', updated_at = now()
WHERE email = 'cliente@hardsystem.local' AND full_name = 'Cliente DEV';
