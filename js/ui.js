/* ============================================================
   Systemach — UI compartida
   Inyección de header/footer, iconos SVG, formato y toasts.
   ============================================================ */

/* ---------- Iconos SVG (librería interna) ---------- */
const HS_ICONS = {
  laptop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M2 20h20"/></svg>',
  desktop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="13" rx="2"/><path d="M8 21h8M12 16v5"/></svg>',
  monitor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M9 21h6"/></svg>',
  keyboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M9 14h6"/></svg>',
  ssd: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 12h4M7 15h7"/></svg>',
  ram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h18v8H3z"/><path d="M6 16v3M10 16v3M14 16v3M18 16v3M7 11v2M11 11v2M15 11v2"/></svg>',
  battery: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="17" height="10" rx="2"/><path d="M22 10v4M6 10.5v3M10 10.5v3"/></svg>',
  psu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="12" r="3"/><path d="M15 9h3M15 12h3M15 15h3"/></svg>',
  router: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="14" width="20" height="6" rx="2"/><path d="M6 17h.01M10 17h.01M12 14V9M8 6.5a6 6 0 018 0"/></svg>',
  switch: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="9" width="20" height="7" rx="2"/><path d="M6 12.5h.01M9.5 12.5h.01M13 12.5h.01M16.5 12.5h.01"/></svg>',
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h10l6-3v14l-6-3H4z"/><circle cx="9" cy="12" r="2.4"/></svg>',
  ups: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M13 7l-4 6h6l-4 6"/></svg>',
  paste: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6v4H9z"/><path d="M7 7h10v13H7z"/><path d="M10 12h4"/></svg>',
  printer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/></svg>',
  hdd: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="9" rx="2"/><circle cx="9" cy="12.5" r="2"/><path d="M17 12.5h.01"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg>',
  wrench: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4.5 4.5 0 00-6 6L3 18l3 3 5.7-5.7a4.5 4.5 0 006-6L14 13l-3-3z"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M19 12a7 7 0 00-.15-1.4l2-1.5-2-3.4-2.3 1a7 7 0 00-2.4-1.4L13.7 2h-3.4l-.45 2.5a7 7 0 00-2.4 1.4l-2.3-1-2 3.4 2 1.5A7 7 0 005 12c0 .48.05.94.15 1.4l-2 1.5 2 3.4 2.3-1a7 7 0 002.4 1.4l.45 2.3h3.4l.45-2.5a7 7 0 002.4-1.4l2.3 1 2-3.4-2-1.5c.1-.46.15-.92.15-1.4z"/></svg>',
  pulse: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>',
  plug: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 7V3M15 7V3M7 7h10v4a5 5 0 01-10 0zM12 16v5"/></svg>',
  server: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="7" rx="2"/><rect x="2" y="14" width="20" height="7" rx="2"/><path d="M6 6.5h.01M6 17.5h.01"/></svg>',
  headset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 13a8 8 0 0116 0"/><rect x="2" y="13" width="5" height="7" rx="2"/><rect x="17" y="13" width="5" height="7" rx="2"/><path d="M19 20a3 3 0 01-3 2h-3"/></svg>',
  cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1.6"/><circle cx="17" cy="20" r="1.6"/><path d="M3 3h2.5l2.4 12.5h11L21.5 7H7"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h4l2 5-2.5 1.5a12 12 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z"/></svg>',
  mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-5.5-7-11a7 7 0 0114 0c0 5.5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/></svg>',
  ticket: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8a2 2 0 002-2h14a2 2 0 002 2v3a2 2 0 000 4v3a2 2 0 00-2 2H5a2 2 0 00-2-2v-3a2 2 0 000-4z"/><path d="M13 6v2M13 11v2M13 16v2"/></svg>',
  box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 20V10M10 20V4M16 20v-8M21 20H3"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
};

function hsIcon(name) { return HS_ICONS[name] || HS_ICONS.box; }

/* ---------- Formato ---------- */
function hsMoney(n) {
  return "$ " + Number(n).toLocaleString("es-CO", { maximumFractionDigits: 0 }) + " COP";
}
function hsEscapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}
function hsSafeUrl(value, fallback = "#") {
  try {
    const url = new URL(String(value ?? ""), location.origin);
    return ["http:", "https:"].includes(url.protocol) ? url.href : fallback;
  } catch { return fallback; }
}

/* ---------- Toast ---------- */
function hsToast(msg) {
  let zone = document.querySelector(".toast-zone");
  if (!zone) {
    zone = document.createElement("div");
    zone.className = "toast-zone";
    document.body.appendChild(zone);
  }
  const t = document.createElement("div");
  t.className = "toast";
  t.innerHTML = hsIcon("check") + "<span></span>";
  t.querySelector("span").textContent = msg;
  zone.appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .3s"; setTimeout(() => t.remove(), 320); }, 2600);
}

/* ---------- Header ---------- */
function hsRenderHeader(active) {
  const items = [
    ["index.html", "Inicio"],
    ["servicios.html", "Servicios"],
    ["catalogo.html", "Catálogo"],
    ["contacto.html", "Contacto"],
  ];
  const nav = items.map(([href, label]) =>
    `<a href="${href}" class="${active === href ? "is-active" : ""}">${label}</a>`).join("");
  const user = typeof HS_API === "undefined" ? null : HS_API.getSessionUser();
  const roleLabels = { client: "Cliente", agent: "Técnico", supervisor: "Supervisor", admin: "Administrador" };
  const userName = hsEscapeHtml(user?.name || "Usuario");
  const sessionAction = user ? `
    <a href="portal.html" class="account-link" aria-label="Abrir portal de ${userName}" title="Abrir mi portal">
      <span class="account-avatar" aria-hidden="true">${hsEscapeHtml((user.name || "U").trim().charAt(0).toUpperCase())}</span>
      <span class="account-copy"><strong>${userName}</strong><small>${roleLabels[user.role] || "Cuenta activa"}</small></span>
    </a>` : '<a href="portal.html" class="btn btn--primary btn--sm">Ingresar</a>';

  const header = document.createElement("header");
  header.className = "site-header";
  header.innerHTML = `
    <div class="container header-inner">
      <a href="index.html" class="brand">
        <img src="Logo/logo-systemach.png" alt="Systemach — Soluciones Tecnológicas">
      </a>
      <nav class="main-nav" id="mainNav">
        ${nav}
        <a href="portal.html">Portal de Soporte</a>
      </nav>
      <div class="header-actions">
        <a href="carrito.html" class="cart-link" aria-label="Carrito de compras">
          ${hsIcon("cart")}
          <span class="cart-badge" id="cartBadge">0</span>
        </a>
        ${sessionAction}
        <button class="nav-toggle" id="navToggle" aria-label="Abrir menú">${hsIcon("menu")}</button>
      </div>
    </div>`;
  document.body.prepend(header);

  document.getElementById("navToggle").addEventListener("click", () => {
    document.getElementById("mainNav").classList.toggle("is-open");
  });
}

/* ---------- Footer ---------- */
function hsRenderFooter() {
  const footer = document.createElement("footer");
  footer.className = "site-footer";
  footer.innerHTML = `
    <div class="container">
      <div class="footer-grid">
        <div class="footer-brand">
          <img src="Logo/logo-systemach.png" alt="Systemach">
          <p>Soporte técnico y soluciones tecnológicas desde Bogotá, Colombia, para hogares y empresas.</p>
        </div>
        <div>
          <h4>Sitio comercial</h4>
          <ul>
            <li><a href="index.html">Inicio</a></li>
            <li><a href="servicios.html">Servicios</a></li>
            <li><a href="catalogo.html">Catálogo</a></li>
            <li><a href="contacto.html">Contacto</a></li>
          </ul>
        </div>
        <div>
          <h4>Plataforma</h4>
          <ul>
            <li><a href="portal.html">Portal de soporte</a></li>
            <li><a href="cliente.html">Vista de cliente</a></li>
            <li><a href="operador.html">Vista de operador</a></li>
            <li><a href="admin.html">Administración</a></li>
          </ul>
        </div>
        <div>
          <h4>Contacto</h4>
          <ul class="footer-contact">
            <li>${hsIcon("pin")} Calle 2 # 93-27, Kennedy, Primavera, Bogotá, Colombia</li>
            <li>${hsIcon("phone")} <a href="tel:+573102681145">+57 310 268 1145</a> · <a href="https://wa.me/573102681145" target="_blank" rel="noopener noreferrer">WhatsApp</a></li>
            <li>${hsIcon("mail")} <a href="mailto:systemachsas@gmail.com">systemachsas@gmail.com</a></li>
            <li>${hsIcon("clock")} Lun – Vie: 8:00 a. m. – 5:00 p. m. · Sáb: 8:00 a. m. – 12:00 p. m.</li>
          </ul>
        </div>
      </div>
      <div class="footer-bottom">
        <span>© 2026 Systemach — Soluciones Tecnológicas. Bogotá, Colombia.</span>
        <span>Precios en pesos colombianos (COP) · Datos simulados.</span>
      </div>
    </div>`;
  document.body.appendChild(footer);
}

/* ---------- Helpers de render ---------- */
function hsProductCard(p) {
  const avail = hsAvailability(p.stock);
  const id = encodeURIComponent(p.id);
  const name = hsEscapeHtml(p.name);
  const imageUrl = hsEscapeHtml(hsSafeUrl(p.imageUrl, ""));
  return `
    <article class="card product-card">
      <a class="product-media" href="producto.html?id=${id}" aria-label="Ver ${name}">
        ${imageUrl ? `<img class="product-image" src="${imageUrl}" alt="">` : `<svg class="product-illu" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">${hsIcon(p.icon).match(/<svg[^>]*>([\s\S]*)<\/svg>/)[1]}</svg>`}
      </a>
      <div class="product-body">
        <span class="product-cat">${hsEscapeHtml(p.category)}</span>
        <h3><a href="producto.html?id=${id}">${name}</a></h3>
        <p class="product-desc">${hsEscapeHtml(p.desc)}</p>
        <div class="product-foot">
          <div class="price">${hsMoney(p.price)}</div>
          <span class="chip ${avail.chip}">${avail.label}</span>
        </div>
        <button class="btn btn--dark btn--sm btn--block mt-2" data-add-cart="${hsEscapeHtml(p.id)}" ${p.stock <= 0 ? "disabled" : ""}>
          ${hsIcon("cart")} ${p.stock <= 0 ? "Sin stock" : "Agregar al carrito"}
        </button>
      </div>
    </article>`;
}

function hsStatusChip(status) {
  const s = HS_TICKET_STATUS[status] || HS_TICKET_STATUS.nuevo;
  return `<span class="chip ${s.chip}">${s.label}</span>`;
}

function hsPriorityChip(priority) {
  const p = HS_PRIORITY[priority] || HS_PRIORITY.media;
  return `<span class="chip ${p.chip}">${p.label}</span>`;
}

function hsInitials(name) {
  return name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
}

/* Delegación global: botones "Agregar al carrito" */
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-add-cart]");
  if (!btn || btn.disabled) return;
  HS_CART.add(btn.dataset.addCart, 1);
});
