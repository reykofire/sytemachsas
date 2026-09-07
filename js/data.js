/* ============================================================
   Systemach — Datos simulados (mock)
   Punto único de verdad para productos, tickets, equipos e
   inventario. Preparado para sustituirse por llamadas a API.
   ============================================================ */

const HS_DATA = {
  promotions: [],
  products: [
    { id: "P-001", name: "Laptop Empresarial HS Pro 14", category: "Equipos", price: 3599900, stock: 12, icon: "laptop",
      desc: "Laptop de 14\" optimizada para entornos empresariales. Intel Core i5, 16 GB RAM, SSD NVMe 512 GB.",
      specs: { Procesador: "Intel Core i5-1335U", Memoria: "16 GB DDR4", Almacenamiento: "SSD NVMe 512 GB", Pantalla: "14\" FHD IPS", Garantía: "12 meses Systemach" } },
    { id: "P-002", name: "PC de Escritorio HS WorkStation", category: "Equipos", price: 2999900, stock: 8, icon: "desktop",
      desc: "Equipo de escritorio ensamblado por Systemach para oficina y diseño ligero. Ryzen 5, 16 GB RAM, SSD 1 TB.",
      specs: { Procesador: "AMD Ryzen 5 5600", Memoria: "16 GB DDR4", Almacenamiento: "SSD 1 TB", Gráficos: "Integrados Radeon", Garantía: "12 meses Systemach" } },
    { id: "P-003", name: "Monitor LED 24\" Full HD", category: "Periféricos", price: 519900, stock: 25, icon: "monitor",
      desc: "Monitor 24\" IPS Full HD con marco ultrafino, ideal para estaciones de trabajo y doble pantalla.",
      specs: { Tamaño: "24 pulgadas", Resolución: "1920 × 1080", Panel: "IPS 75 Hz", Conectores: "HDMI + VGA", Garantía: "12 meses" } },
    { id: "P-004", name: "Teclado + Mouse Inalámbrico", category: "Periféricos", price: 139900, stock: 40, icon: "keyboard",
      desc: "Combo inalámbrico 2.4 GHz de bajo consumo, diseño ergonómico y teclas silenciosas.",
      specs: { Conectividad: "USB 2.4 GHz", Batería: "Hasta 12 meses", Layout: "Español (ES)", Garantía: "6 meses" } },
    { id: "P-005", name: "Disco SSD NVMe 1 TB", category: "Repuestos", price: 359900, stock: 18, icon: "ssd",
      desc: "Unidad de estado sólido NVMe Gen3 de 1 TB. Lectura hasta 3,500 MB/s. Ideal para actualizar equipos lentos.",
      specs: { Capacidad: "1 TB", Interfaz: "NVMe PCIe Gen3 ×4", Lectura: "3,500 MB/s", Escritura: "3,000 MB/s", Garantía: "24 meses" } },
    { id: "P-006", name: "Memoria RAM DDR4 16 GB", category: "Repuestos", price: 219900, stock: 30, icon: "ram",
      desc: "Módulo DDR4 3200 MHz de 16 GB para laptops y desktops. Actualización instantánea de rendimiento.",
      specs: { Capacidad: "16 GB", Tipo: "DDR4 3200 MHz", Formato: "SO-DIMM / DIMM", Garantía: "24 meses" } },
    { id: "P-007", name: "Batería para Laptop Universal", category: "Repuestos", price: 259900, stock: 6, icon: "battery",
      desc: "Baterías de reemplazo compatibles con HP, Dell, Lenovo y Asus. Consulta disponibilidad por modelo.",
      specs: { Compatibilidad: "HP / Dell / Lenovo / Asus", Celdas: "Litio-ion 6 celdas", Garantía: "12 meses" } },
    { id: "P-008", name: "Fuente de Poder 650W 80+", category: "Repuestos", price: 289900, stock: 0, icon: "psu",
      desc: "Fuente certificada 80+ Bronze, protección contra sobrevoltaje. Para ensambles y reemplazos.",
      specs: { Potencia: "650 W", Certificación: "80+ Bronze", Conectores: "ATX 24p, EPS 8p, PCIe", Garantía: "24 meses" } },
    { id: "P-009", name: "Router Wi-Fi 6 Dual Band", category: "Redes", price: 479900, stock: 14, icon: "router",
      desc: "Router AX1800 Wi-Fi 6 para oficinas y hogares exigentes. 4 antenas, MU-MIMO y WPA3.",
      specs: { Estándar: "Wi-Fi 6 (802.11ax)", Velocidad: "AX1800 dual band", Puertos: "4× GbE LAN + 1× WAN", Seguridad: "WPA3", Garantía: "12 meses" } },
    { id: "P-010", name: "Switch Gigabit 8 Puertos", category: "Redes", price: 179900, stock: 20, icon: "switch",
      desc: "Switch no administrable 8 puertos 10/100/1000, carcasa metálica, plug & play.",
      specs: { Puertos: "8 × RJ45 GbE", Capacidad: "16 Gbps", Montaje: "Escritorio / pared", Garantía: "12 meses" } },
    { id: "P-011", name: "Cámara IP de Seguridad PoE", category: "Redes", price: 319900, stock: 9, icon: "camera",
      desc: "Cámara IP 4 MP con visión nocturna, alimentación PoE y acceso remoto desde app móvil.",
      specs: { Resolución: "4 MP QHD", Alimentación: "PoE 802.3af", Visión: "Nocturna 30 m", Uso: "Interior / exterior IP66", Garantía: "12 meses" } },
    { id: "P-012", name: "UPS 1500VA Interactivo", category: "Energía", price: 639900, stock: 4, icon: "ups",
      desc: "Respaldo de energía 1500VA/900W con regulador integrado. Protege tus equipos ante cortes y picos.",
      specs: { Capacidad: "1500 VA / 900 W", Autonomía: "10–15 min (carga típica)", Salidas: "6 tomas", Garantía: "12 meses" } },
    { id: "P-013", name: "Pasta Térmica Premium 4g", category: "Repuestos", price: 39900, stock: 50, icon: "paste",
      desc: "Compuesto térmico de alta conductividad para mantenimiento de CPU/GPU. Incluye espátula.",
      specs: { Contenido: "4 gramos", Conductividad: "8.5 W/mK", Aplicación: "CPU / GPU / consolas", Garantía: "N/A" } },
    { id: "P-014", name: "Impresora Láser Monocromática", category: "Equipos", price: 759900, stock: 7, icon: "printer",
      desc: "Impresora láser 30 ppm con dúplex automático y red Ethernet. Costo por página ultra bajo.",
      specs: { Velocidad: "30 ppm", Dúplex: "Automático", Conectividad: "USB + Ethernet", Garantía: "12 meses" } },
    { id: "P-015", name: "Disco Duro Externo 2 TB", category: "Periféricos", price: 279900, stock: 16, icon: "hdd",
      desc: "Almacenamiento portátil USB 3.0 de 2 TB para respaldos. Resistente a golpes.",
      specs: { Capacidad: "2 TB", Interfaz: "USB 3.0", Formato: "2.5\" portátil", Garantía: "12 meses" } },
    { id: "P-016", name: "Licencia Antivirus Empresarial", category: "Software", price: 159900, stock: 100, icon: "shield",
      desc: "Protección endpoint por 1 año: antivirus, anti-ransomware y firewall personal. 1 dispositivo.",
      specs: { Vigencia: "12 meses", Dispositivos: "1", Plataforma: "Windows / macOS", Soporte: "Incluido", Garantía: "N/A" } },
  ],

  services: [
    { id: "redes-electricas", icon: "plug", title: "Redes eléctricas",
      desc: "Soluciones de infraestructura eléctrica para proyectos tecnológicos de empresas y hogares.",
      items: ["Infraestructura tecnológica", "Atención a empresas y hogares"] },
    { id: "redes-datos", icon: "router", title: "Redes de datos",
      desc: "Soluciones de conectividad para acompañar la operación y el crecimiento de cada cliente.",
      items: ["Redes de datos", "Conectividad empresarial y residencial"] },
    { id: "cctv", icon: "camera", title: "CCTV y seguridad",
      desc: "Soluciones de videovigilancia como parte de una infraestructura tecnológica integral.",
      items: ["CCTV", "Seguridad para empresas y hogares"] },
    { id: "reparacion", icon: "wrench", title: "Reparación de equipos",
      desc: "Diagnóstico y reparación de laptops, desktops, impresoras y periféricos con repuestos garantizados.",
      items: ["Cambio de pantallas, teclados y baterías", "Reparación de placas y fuentes", "Recuperación ante daños por líquidos"] },
    { id: "mantenimiento", icon: "gear", title: "Mantenimiento preventivo",
      desc: "Planes periódicos que alargan la vida útil de tu infraestructura y previenen fallas costosas.",
      items: ["Limpieza física y cambio de pasta térmica", "Optimización de sistema operativo", "Planes mensuales para empresas"] },
    { id: "diagnostico", icon: "pulse", title: "Diagnóstico avanzado",
      desc: "Evaluación técnica completa con informe detallado del estado de hardware y software.",
      items: ["Pruebas de estrés de componentes", "Informe con prioridades de atención", "Cotización sin compromiso"] },
    { id: "instalacion", icon: "plug", title: "Instalación y configuración",
      desc: "Puesta en marcha de equipos, redes, cámaras de seguridad y software empresarial.",
      items: ["Redes cableadas e inalámbricas", "Cámaras IP y videovigilancia", "Migración de datos y software"] },
    { id: "administracion", icon: "server", title: "Administración TI",
      desc: "Gestión integral de tu parque tecnológico: servidores, respaldos, usuarios y seguridad.",
      items: ["Administración de servidores", "Respaldos automáticos y monitoreo", "Soporte remoto a usuarios"] },
    { id: "soporte", icon: "headset", title: "Soporte técnico continuo",
      desc: "Atención prioritaria con portal de tickets, seguimiento en tiempo real e historial completo.",
      items: ["Portal de incidencias 24/7", "SLA según plan contratado", "Soporte presencial y remoto"] },
  ],

  tickets: [
    { id: "TK-1042", client: "Comercial Andina", subject: "Laptop no enciende", device: "HP ProBook 440", status: "nuevo", priority: "alta", assignee: null, opened: "2026-08-29", progress: 10 },
    { id: "TK-1041", client: "María González", subject: "PC muy lenta tras actualización", device: "Desktop HP Pavilion", status: "nuevo", priority: "media", assignee: null, opened: "2026-08-29", progress: 5 },
    { id: "TK-1038", client: "Farmacia del Sol", subject: "Impresora de tickets sin conexión", device: "Epson TM-T20", status: "progreso", priority: "alta", assignee: "Carlos Ruiz", opened: "2026-08-27", progress: 55 },
    { id: "TK-1036", client: "Estudio Jurídico Roca", subject: "Configurar respaldos automáticos", device: "Servidor Dell T40", status: "progreso", priority: "media", assignee: "Ana Torres", opened: "2026-08-26", progress: 70 },
    { id: "TK-1033", client: "Javier Medina", subject: "Instalación de red Wi-Fi oficina", device: "Red / Router AX1800", status: "pendiente", priority: "baja", assignee: "Carlos Ruiz", opened: "2026-08-24", progress: 40 },
    { id: "TK-1030", client: "Comercial Andina", subject: "Cambio de batería laptop", device: "Lenovo ThinkPad E14", status: "resuelto", priority: "media", assignee: "Ana Torres", opened: "2026-08-20", progress: 100 },
    { id: "TK-1027", client: "Clínica Santa Fe", subject: "Mantenimiento preventivo 8 equipos", device: "Parque de equipos", status: "resuelto", priority: "baja", assignee: "Luis Paredes", opened: "2026-08-18", progress: 100 },
    { id: "TK-1021", client: "María González", subject: "Recuperación de datos disco dañado", device: "HDD Seagate 1 TB", status: "cerrado", priority: "alta", assignee: "Luis Paredes", opened: "2026-08-12", progress: 100 },
    { id: "TK-1015", client: "Farmacia del Sol", subject: "Instalación cámaras de seguridad", device: "4× Cámaras IP PoE", status: "cerrado", priority: "media", assignee: "Carlos Ruiz", opened: "2026-08-05", progress: 100 },
  ],

  clientTickets: [
    { id: "TK-1038", subject: "Impresora de tickets sin conexión", device: "Epson TM-T20", status: "progreso", priority: "alta", opened: "2026-08-27", updated: "2026-08-29", progress: 55,
      note: "Técnico asignado: Carlos Ruiz. Se ordenó cable de red de repuesto." },
    { id: "TK-1033", subject: "Instalación de red Wi-Fi oficina", device: "Router AX1800", status: "pendiente", priority: "baja", opened: "2026-08-24", updated: "2026-08-28", progress: 40,
      note: "En espera de aprobación de cotización por parte del cliente." },
    { id: "TK-1030", subject: "Cambio de batería laptop", device: "Lenovo ThinkPad E14", status: "resuelto", priority: "media", opened: "2026-08-20", updated: "2026-08-22", progress: 100,
      note: "Batería reemplazada. Equipo entregado el 22/08 con garantía de 6 meses." },
    { id: "TK-1021", subject: "Recuperación de datos disco dañado", device: "HDD Seagate 1 TB", status: "cerrado", priority: "alta", opened: "2026-08-12", updated: "2026-08-16", progress: 100,
      note: "Se recuperó el 97% de la información. Entregada en SSD nuevo." },
  ],

  devices: [
    { id: "EQ-011", name: "HP ProBook 440 G8", type: "Laptop", serial: "HS-2024-8841", lastService: "2026-06-14", status: "operativo", icon: "laptop" },
    { id: "EQ-012", name: "Epson TM-T20", type: "Impresora térmica", serial: "HS-2023-2290", lastService: "2026-08-27", status: "en servicio", icon: "printer" },
    { id: "EQ-013", name: "Lenovo ThinkPad E14", type: "Laptop", serial: "HS-2025-0173", lastService: "2026-08-22", status: "operativo", icon: "laptop" },
    { id: "EQ-014", name: "Router AX1800", type: "Red", serial: "HS-2026-0054", lastService: "—", status: "por instalar", icon: "router" },
  ],

  history: [
    { date: "29 Ago 2026", title: "Ticket TK-1042 creado", desc: "Se registró la incidencia \"Laptop no enciende\" con prioridad alta.", muted: false },
    { date: "27 Ago 2026", title: "Diagnóstico de impresora", desc: "Se detectó falla en el puerto de red de la Epson TM-T20.", muted: false },
    { date: "22 Ago 2026", title: "Equipo entregado", desc: "Lenovo ThinkPad E14 entregado con batería nueva y garantía.", muted: false },
    { date: "16 Ago 2026", title: "Recuperación de datos completada", desc: "97% de información recuperada del HDD Seagate 1 TB.", muted: true },
    { date: "05 Ago 2026", title: "Proyecto de videovigilancia", desc: "Instalación de 4 cámaras IP PoE finalizada y cerrada.", muted: true },
  ],

  operators: ["Carlos Ruiz", "Ana Torres", "Luis Paredes"],

  inventory: [
    { sku: "RP-100", item: "Pantalla 14\" FHD", category: "Pantallas", stock: 9, min: 4 },
    { sku: "RP-101", item: "Batería HP ProBook", category: "Baterías", stock: 3, min: 5 },
    { sku: "RP-102", item: "SSD NVMe 512 GB", category: "Almacenamiento", stock: 14, min: 6 },
    { sku: "RP-103", item: "RAM DDR4 8 GB SO-DIMM", category: "Memoria", stock: 22, min: 8 },
    { sku: "RP-104", item: "Teclado Lenovo E14", category: "Teclados", stock: 2, min: 3 },
    { sku: "RP-105", item: "Cable de red Cat6 3m", category: "Redes", stock: 48, min: 15 },
    { sku: "RP-106", item: "Pasta térmica 4g", category: "Consumibles", stock: 35, min: 10 },
    { sku: "RP-107", item: "Fuente ATX 650W", category: "Fuentes", stock: 5, min: 4 },
  ],

  faqs: [
    { q: "¿Cuánto tarda un diagnóstico?", a: "El diagnóstico estándar toma entre 24 y 48 horas hábiles. Para clientes con plan de soporte empresarial, el diagnóstico prioritario se realiza el mismo día." },
    { q: "¿El diagnóstico tiene costo?", a: "El diagnóstico tiene un costo simbólico que se descuenta del total si decides realizar la reparación con nosotros. Las cotizaciones son siempre sin compromiso." },
    { q: "¿Ofrecen garantía en las reparaciones?", a: "Sí. Todas las reparaciones incluyen garantía de 6 meses en mano de obra y la garantía del fabricante en repuestos (12 a 24 meses según componente)." },
    { q: "¿Atienden a domicilio o empresas?", a: "Sí, contamos con servicio a domicilio y planes empresariales que incluyen visitas programadas, soporte remoto y atención prioritaria mediante nuestro portal de tickets." },
    { q: "¿Cómo puedo dar seguimiento a mi equipo?", a: "Desde el Portal de Soporte puedes ver el estado de tus incidencias en tiempo real, los equipos registrados a tu nombre y el historial completo de servicios." },
  ],
};

async function hsLoadCommerce() {
  try {
    const response = await fetch("/api/commerce");
    if (!response.ok) return;
    const commerce = await response.json();
    HS_DATA.promotions = commerce.promotions || [];
    if (commerce.products?.length) HS_DATA.products = commerce.products.map(product => ({ id: product.id, sku: product.sku, name: product.name, desc: product.description || "", category: product.category, price: Number(product.price_cop), stock: product.stock, icon: product.icon || "box", imageUrl: product.image_url, specs: product.specifications || {}, featured: product.is_featured }));
  } catch { /* El contenido integrado mantiene disponible el sitio si el API no responde. */ }
}

/* Estados de tickets: etiqueta y clase CSS */
const HS_TICKET_STATUS = {
  nuevo:    { label: "Nuevo",       chip: "chip--nuevo" },
  progreso: { label: "En progreso", chip: "chip--progreso" },
  pendiente:{ label: "Pendiente",   chip: "chip--pendiente" },
  resuelto: { label: "Resuelto",    chip: "chip--resuelto" },
  cerrado:  { label: "Cerrado",     chip: "chip--cerrado" },
};

const HS_PRIORITY = {
  alta:  { label: "Alta",  chip: "chip--alta" },
  media: { label: "Media", chip: "chip--media" },
  baja:  { label: "Baja",  chip: "chip--baja" },
};

/* Disponibilidad según stock */
function hsAvailability(stock) {
  if (stock <= 0) return { label: "Agotado", chip: "chip--agotado" };
  if (stock <= 7) return { label: "Últimas unidades", chip: "chip--bajo" };
  return { label: "En stock", chip: "chip--stock" };
}
