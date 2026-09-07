BEGIN;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS icon text NOT NULL DEFAULT 'box',
  ADD COLUMN IF NOT EXISTS specifications jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS is_featured boolean NOT NULL DEFAULT false;

CREATE TABLE commerce_promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot smallint NOT NULL UNIQUE CHECK (slot IN (1, 2)),
  badge text NOT NULL,
  title text NOT NULL,
  accent text NOT NULL,
  description text NOT NULL,
  primary_label text NOT NULL,
  primary_url text NOT NULL,
  secondary_label text NOT NULL,
  secondary_url text NOT NULL,
  note_label text NOT NULL,
  note_text text NOT NULL,
  image_url text NOT NULL,
  image_alt text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  starts_at timestamptz,
  ends_at timestamptz,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER commerce_promotions_set_updated_at
  BEFORE UPDATE ON commerce_promotions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO commerce_promotions(slot,badge,title,accent,description,primary_label,primary_url,secondary_label,secondary_url,note_label,note_text,image_url,image_alt)
VALUES
  (1,'Promoción para empresas · Vigencia limitada','Diagnóstico prioritario sin costo.','prioritario','Agenda la revisión de tus equipos y recibe una evaluación clara para planear mantenimiento, renovaciones y mejoras sin sorpresas.','Agendar diagnóstico','contacto.html?servicio=diagnostico','Conocer servicios','servicios.html','Incluye:','revisión inicial, recomendaciones y cotización detallada.','slide/diagnostico.png','Diagnóstico técnico de un computador de escritorio'),
  (2,'Oferta de la semana · Componentes seleccionados','Más velocidad para tu equipo.','equipo','Actualiza con unidades SSD y memoria RAM seleccionadas para mejorar el arranque, la respuesta y la productividad de tu computador.','Ver componentes','catalogo.html','Pedir asesoría','contacto.html','Oferta:','instalación técnica con precio preferencial al comprar tu componente.','slide/memorias.png','Módulos de memoria RAM y unidad SSD NVMe')
ON CONFLICT (slot) DO NOTHING;

INSERT INTO schema_migrations(version) VALUES ('008_commerce_content_management');

COMMIT;
