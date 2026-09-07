BEGIN;

INSERT INTO products(sku,name,description,category,price_cop,stock,icon,is_featured)
VALUES
('P-001','Laptop Empresarial HS Pro 14','Laptop de 14 pulgadas optimizada para entornos empresariales. Intel Core i5, 16 GB RAM, SSD NVMe 512 GB.','Equipos',3599900,12,'laptop',true),
('P-002','PC de Escritorio HS WorkStation','Equipo de escritorio ensamblado por HardSystem para oficina y diseño ligero. Ryzen 5, 16 GB RAM, SSD 1 TB.','Equipos',2999900,8,'desktop',true),
('P-003','Monitor LED 24 Full HD','Monitor IPS Full HD con marco ultrafino, ideal para estaciones de trabajo y doble pantalla.','Periféricos',519900,25,'monitor',true),
('P-004','Teclado + Mouse Inalámbrico','Combo inalámbrico 2.4 GHz de bajo consumo, diseño ergonómico y teclas silenciosas.','Periféricos',139900,40,'keyboard',true),
('P-005','Disco SSD NVMe 1 TB','Unidad de estado sólido NVMe Gen3 de 1 TB. Lectura hasta 3,500 MB/s.','Repuestos',359900,18,'ssd',false),
('P-006','Memoria RAM DDR4 16 GB','Módulo DDR4 3200 MHz de 16 GB para laptops y equipos de escritorio.','Repuestos',219900,30,'ram',false),
('P-007','Batería para Laptop Universal','Baterías de reemplazo compatibles con HP, Dell, Lenovo y Asus.','Repuestos',259900,6,'battery',false),
('P-008','Fuente de Poder 650W 80+','Fuente certificada 80+ Bronze con protección contra sobrevoltaje.','Repuestos',289900,0,'psu',false),
('P-009','Router Wi-Fi 6 Dual Band','Router AX1800 Wi-Fi 6 para oficinas y hogares exigentes.','Redes',479900,14,'router',false),
('P-010','Switch Gigabit 8 Puertos','Switch no administrable de 8 puertos Gigabit, carcasa metálica y plug and play.','Redes',179900,20,'switch',false),
('P-011','Cámara IP de Seguridad PoE','Cámara IP 4 MP con visión nocturna, alimentación PoE y acceso remoto.','Redes',319900,9,'camera',false),
('P-012','UPS 1500VA Interactivo','Respaldo de energía 1500VA/900W con regulador integrado.','Energía',639900,4,'ups',false),
('P-013','Pasta Térmica Premium 4g','Compuesto térmico de alta conductividad para mantenimiento de CPU y GPU.','Repuestos',39900,50,'paste',false),
('P-014','Impresora Láser Monocromática','Impresora láser de 30 ppm con dúplex automático y red Ethernet.','Equipos',759900,7,'printer',false),
('P-015','Disco Duro Externo 2 TB','Almacenamiento portátil USB 3.0 de 2 TB para respaldos.','Periféricos',279900,16,'hdd',false),
('P-016','Licencia Antivirus Empresarial','Protección endpoint por un año con antivirus, anti-ransomware y firewall.','Software',159900,100,'shield',false)
ON CONFLICT (sku) DO NOTHING;

INSERT INTO schema_migrations(version) VALUES ('009_seed_commerce_catalog');

COMMIT;