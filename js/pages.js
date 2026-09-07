/* ============================================================
   Systemach — Inicializadores por página
   Cada página define <body data-page="..."> y aquí se despacha.
   ============================================================ */

document.addEventListener("DOMContentLoaded", async () => {
  await hsLoadCommerce();
  await HS_CART.init();
  const page = document.body.dataset.page || "home";
  hsRenderHeader(page === "home" ? "index.html" : page + ".html");
  hsRenderFooter();
  HS_CART.updateBadge();

  const init = {
    home: initHome,
    servicios: initServicios,
    catalogo: initCatalogo,
    producto: initProducto,
    carrito: initCarrito,
    contacto: initContacto,
    soporte: initSoporte,
    cliente: initCliente,
    operador: initOperador,
    admin: initAdmin,
  }[page];

  if (init) init();
});

/* ==================== INICIO ==================== */
function initHome() {
  applyPublishedPromotions();
  initHeroCarousel();

  // Servicios destacados (primeros 4)
  const svcGrid = document.getElementById("homeServices");
  svcGrid.innerHTML = HS_DATA.services.slice(0, 4).map(s => `
    <article class="card service-card">
      <div class="service-icon">${hsIcon(s.icon)}</div>
      <h3>${s.title}</h3>
      <p>${s.desc}</p>
      <a class="card-link" href="servicios.html#${s.id}">Conocer más ${hsIcon("arrow")}</a>
    </article>`).join("");

  // Productos destacados (stock > 0, primeros 4)
  const prodGrid = document.getElementById("homeProducts");
  prodGrid.innerHTML = HS_DATA.products.filter(p => p.stock > 0).slice(0, 4).map(hsProductCard).join("");

  // Testimonios
  const testimonials = [
    { name: "Comercial Andina", role: "Cliente empresarial", text: "Systemach administra todo nuestro parque de equipos. El portal de tickets nos da visibilidad total de cada servicio." },
    { name: "María González", role: "Cliente hogar", text: "Recuperaron los datos de mi disco dañado cuando otros dijeron que era imposible. Atención clara y precios justos." },
    { name: "Farmacia del Sol", role: "Cliente empresarial", text: "Instalaron las cámaras y la red de nuestras dos sucursales. Trabajo limpio, rápido y con garantía real." },
  ];
  document.getElementById("homeTestimonials").innerHTML = testimonials.map(t => `
    <article class="card service-card">
      <div class="assignee"><span class="avatar">${hsInitials(t.name)}</span>
        <div><strong>${t.name}</strong><br><span class="text-muted" style="font-size:.8rem">${t.role}</span></div>
      </div>
      <p>“${t.text}”</p>
    </article>`).join("");
}

function applyPublishedPromotions() {
  const slides = [...document.querySelectorAll("[data-hero-slide]")].slice(1);
  HS_DATA.promotions.forEach((promotion, index) => {
    const slide = slides[index]; if (!slide) return;
    const badge = slide.querySelector(".hero-badge"); badge.lastChild.textContent = ` ${promotion.badge}`;
    const heading = slide.querySelector("h1"); const title = promotion.title; const accent = promotion.accent; const match = title.toLowerCase().indexOf(accent.toLowerCase()); heading.textContent = "";
    if (match >= 0) { heading.append(document.createTextNode(title.slice(0,match))); const span=document.createElement("span"); span.className="accent"; span.textContent=title.slice(match,match+accent.length); heading.append(span,document.createTextNode(title.slice(match+accent.length))); } else heading.textContent=title;
    slide.querySelector("p.lead").textContent = promotion.description;
    const links = slide.querySelectorAll(".hero-cta a"); links[0].textContent=promotion.primary_label; links[0].href=hsSafeUrl(promotion.primary_url); links[1].textContent=promotion.secondary_label; links[1].href=hsSafeUrl(promotion.secondary_url);
    slide.querySelector(".hero-offer-note strong").textContent=promotion.note_label; slide.querySelector(".hero-offer-note").lastChild.textContent=` ${promotion.note_text}`;
    const image=slide.querySelector(".hero-product-image"); image.src=hsSafeUrl(promotion.image_url, ""); image.alt=promotion.image_alt;
  });
}

function initHeroCarousel() {
  const carousel = document.querySelector("[data-hero-carousel]");
  if (!carousel) return;
  const slides = [...carousel.querySelectorAll("[data-hero-slide]")];
  const dots = [...carousel.querySelectorAll("[data-hero-dot]")];
  let active = 0;
  let timer;

  function showSlide(index) {
    active = (index + slides.length) % slides.length;
    slides.forEach((slide, i) => slide.classList.toggle("is-active", i === active));
    dots.forEach((dot, i) => {
      dot.classList.toggle("is-active", i === active);
      dot.setAttribute("aria-selected", i === active ? "true" : "false");
    });
  }
  function restartTimer() {
    clearInterval(timer);
    timer = setInterval(() => showSlide(active + 1), 7000);
  }

  carousel.querySelector("[data-hero-prev]").addEventListener("click", () => { showSlide(active - 1); restartTimer(); });
  carousel.querySelector("[data-hero-next]").addEventListener("click", () => { showSlide(active + 1); restartTimer(); });
  dots.forEach((dot) => dot.addEventListener("click", () => { showSlide(Number(dot.dataset.heroDot)); restartTimer(); }));
  carousel.addEventListener("mouseenter", () => clearInterval(timer));
  carousel.addEventListener("mouseleave", restartTimer);
  carousel.addEventListener("focusin", () => clearInterval(timer));
  carousel.addEventListener("focusout", (event) => { if (!carousel.contains(event.relatedTarget)) restartTimer(); });
  restartTimer();
}

/* ==================== SERVICIOS ==================== */
function initServicios() {
  const grid = document.getElementById("servicesGrid");
  grid.innerHTML = HS_DATA.services.map(s => `
    <article class="card service-card" id="${s.id}">
      <div class="service-icon">${hsIcon(s.icon)}</div>
      <h3>${s.title}</h3>
      <p>${s.desc}</p>
      <ul>${s.items.map(i => `<li>${i}</li>`).join("")}</ul>
      <a class="card-link" href="contacto.html?servicio=${s.id}">Solicitar este servicio ${hsIcon("arrow")}</a>
    </article>`).join("");
}

/* ==================== CATÁLOGO ==================== */
function initCatalogo() {
  const grid = document.getElementById("catalogGrid");
  const filters = document.getElementById("catalogFilters");
  const searchInput = document.getElementById("catalogSearch");
  const count = document.getElementById("catalogCount");
  let activeCat = "Todos";
  let query = "";

  const cats = ["Todos", ...new Set(HS_DATA.products.map(p => p.category))];
  filters.innerHTML = cats.map(c =>
    `<button class="chip-filter ${c === "Todos" ? "is-active" : ""}" data-cat="${hsEscapeHtml(c)}">${hsEscapeHtml(c)}</button>`).join("");

  function render() {
    const list = HS_DATA.products.filter(p =>
      (activeCat === "Todos" || p.category === activeCat) &&
      (p.name + " " + p.desc).toLowerCase().includes(query));
    grid.innerHTML = list.length
      ? list.map(hsProductCard).join("")
      : `<div class="card empty-state" style="grid-column:1/-1">
           ${hsIcon("search")}<h3>Sin resultados</h3>
           <p>No encontramos productos para tu búsqueda. Intenta con otra categoría o término.</p>
         </div>`;
    count.textContent = `${list.length} producto${list.length !== 1 ? "s" : ""}`;
  }

  filters.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-cat]");
    if (!btn) return;
    activeCat = btn.dataset.cat;
    filters.querySelectorAll(".chip-filter").forEach(b => b.classList.toggle("is-active", b === btn));
    render();
  });
  searchInput.addEventListener("input", () => { query = searchInput.value.trim().toLowerCase(); render(); });

  render();
}

/* ==================== FICHA DE PRODUCTO ==================== */
function initProducto() {
  const id = new URLSearchParams(location.search).get("id");
  const p = HS_DATA.products.find(x => x.id === id) || HS_DATA.products[0];
  const avail = hsAvailability(p.stock);
  document.title = `${p.name} — Systemach`;

  document.getElementById("breadcrumbCurrent").textContent = p.name;
  const wrap = document.getElementById("productDetail");
  const productId = encodeURIComponent(p.id);
  const imageUrl = hsEscapeHtml(hsSafeUrl(p.imageUrl, ""));
  wrap.innerHTML = `
    <div class="product-media">
      ${imageUrl ? `<img class="product-image product-image--detail" src="${imageUrl}" alt="${hsEscapeHtml(p.name)}">` : `<svg class="product-illu" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">${hsIcon(p.icon).match(/<svg[^>]*>([\s\S]*)<\/svg>/)[1]}</svg>`}
    </div>
    <div>
      <span class="product-cat">${hsEscapeHtml(p.category)} · ${hsEscapeHtml(p.id)}</span>
      <h1 style="font-size:1.8rem;margin:8px 0 6px">${hsEscapeHtml(p.name)}</h1>
      <div class="detail-meta">
        <span class="chip ${avail.chip}">${avail.label}</span>
        ${p.stock > 0 ? `<span class="text-muted" style="font-size:.85rem">${p.stock} unidades disponibles</span>` : ""}
      </div>
      <div class="detail-price">${hsMoney(p.price)}</div>
      <p class="text-muted mt-2">${hsEscapeHtml(p.desc)}</p>
      <div class="flex-between mt-3" style="justify-content:flex-start">
        <div class="qty-selector">
          <button type="button" id="qtyMinus" aria-label="Disminuir">−</button>
          <input type="text" id="qtyInput" value="1" inputmode="numeric" aria-label="Cantidad">
          <button type="button" id="qtyPlus" aria-label="Aumentar">+</button>
        </div>
        <button class="btn btn--primary" id="detailAdd" ${p.stock <= 0 ? "disabled" : ""}>
          ${hsIcon("cart")} ${p.stock <= 0 ? "Producto agotado" : "Agregar al carrito"}
        </button>
      </div>
      <table class="spec-table">
        <tbody>
          ${Object.entries(p.specs).map(([k, v]) => `<tr><th>${hsEscapeHtml(k)}</th><td>${hsEscapeHtml(v)}</td></tr>`).join("")}
        </tbody>
      </table>
    </div>`;

  const qtyInput = document.getElementById("qtyInput");
  const clamp = () => {
    let v = parseInt(qtyInput.value.replace(/\D/g, ""), 10) || 1;
    qtyInput.value = Math.max(1, Math.min(v, Math.max(p.stock, 1)));
  };
  document.getElementById("qtyMinus").addEventListener("click", () => { qtyInput.value = Math.max(1, (parseInt(qtyInput.value, 10) || 1) - 1); });
  document.getElementById("qtyPlus").addEventListener("click", () => { qtyInput.value = Math.min(Math.max(p.stock, 1), (parseInt(qtyInput.value, 10) || 1) + 1); });
  qtyInput.addEventListener("change", clamp);
  document.getElementById("detailAdd").addEventListener("click", () => {
    clamp();
    HS_CART.add(p.id, parseInt(qtyInput.value, 10));
  });

  // Relacionados
  const rel = HS_DATA.products.filter(x => x.category === p.category && x.id !== p.id).slice(0, 4);
  const relWrap = document.getElementById("relatedGrid");
  if (rel.length) {
    relWrap.innerHTML = rel.map(hsProductCard).join("");
  } else {
    document.getElementById("relatedSection").classList.add("hidden");
  }
}

/* ==================== CARRITO ==================== */
function initCarrito() {
  const listEl = document.getElementById("cartList");
  const summaryEl = document.getElementById("cartSummary");
  const SHIPPING = 25000;
  let paypalLoading = false;

  function shippingCop(items = HS_CART.get()) {
    return items.length && items.every(item => item.specs?.shipping === "free") ? 0 : SHIPPING;
  }

  function loadPayPalSdk(clientId) {
    if (window.paypal) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const existing = document.getElementById("paypalSdk");
      if (existing) { existing.addEventListener("load", resolve, { once: true }); existing.addEventListener("error", reject, { once: true }); return; }
      const script = document.createElement("script");
      script.id = "paypalSdk";
      script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture&locale=es_CO`;
      script.onload = resolve;
      script.onerror = () => reject(new Error("No fue posible cargar PayPal"));
      document.head.appendChild(script);
    });
  }

  async function startPayPal() {
    if (!HS_API.getSessionUser()) {
      sessionStorage.setItem("hs_return_to", "carrito.html?checkout=paypal");
      location.href = "portal.html";
      return;
    }
    if (paypalLoading) return;
    paypalLoading = true;
    const button = document.getElementById("checkoutBtn");
    const status = document.getElementById("paypalStatus");
    button.disabled = true;
    status.textContent = "Preparando el pago seguro...";
    try {
      const config = await HS_API.request("/payments/paypal/config");
      if (!config.enabled) throw new Error("PayPal está pendiente de activación por Systemach");
      const totalCop = HS_CART.subtotal() + shippingCop();
      const amountUsd = (totalCop / config.copPerUsd).toLocaleString("en-US", { style: "currency", currency: "USD" });
      document.getElementById("paypalConversion").innerHTML = `<strong>Total en PayPal: ${amountUsd} USD</strong><span>Tasa aplicada: $ ${Number(config.copPerUsd).toLocaleString("es-CO")} COP por USD</span>`;
      document.getElementById("paypalPanel").classList.remove("hidden");
      button.classList.add("hidden");
      await loadPayPalSdk(config.clientId);
      status.textContent = "Selecciona PayPal o tarjeta para aprobar el pago en USD.";
      await window.paypal.Buttons({
        style: { layout: "vertical", color: "gold", shape: "rect", label: "paypal", height: 44 },
        createOrder: async () => (await HS_API.request("/payments/paypal/orders", { method: "POST", body: "{}" })).paypalOrderId,
        onApprove: async data => {
          status.textContent = "Confirmando el pago y registrando tu compra...";
          const result = await HS_API.request(`/payments/paypal/orders/${encodeURIComponent(data.orderID)}/capture`, { method: "POST", body: "{}" });
          await HS_CART.init();
          hsToast(`Compra OC-${result.order.order_number} confirmada`);
          location.href = "portal.html?view=orders";
        },
        onCancel: () => { status.textContent = "Pago cancelado. Tu carrito permanece guardado."; },
        onError: error => { console.error(error); status.textContent = "PayPal no pudo completar la operación. Intenta nuevamente."; },
      }).render("#paypalButtons");
    } catch (error) {
      status.textContent = error.message || "No fue posible iniciar PayPal";
      button.disabled = false;
    } finally {
      paypalLoading = false;
    }
  }

  function render() {
    const items = HS_CART.get();
    if (!items.length) {
      listEl.innerHTML = `
        <div class="card empty-state">
          ${hsIcon("cart")}
          <h3>Tu carrito está vacío</h3>
          <p>Explora el catálogo y agrega equipos, repuestos o soluciones.</p>
          <a class="btn btn--primary" href="catalogo.html">Ir al catálogo</a>
        </div>`;
      summaryEl.classList.add("hidden");
      return;
    }
    summaryEl.classList.remove("hidden");
    listEl.innerHTML = `<div class="card">` + items.map(i => `
      <div class="cart-item" data-line="${hsEscapeHtml(i.id)}">
        <a class="cart-thumb" href="producto.html?id=${encodeURIComponent(i.id)}">${i.imageUrl ? `<img src="${hsEscapeHtml(hsSafeUrl(i.imageUrl, ""))}" alt="${hsEscapeHtml(i.name)}">` : hsIcon(i.icon)}</a>
        <div>
          <h4><a href="producto.html?id=${encodeURIComponent(i.id)}" style="color:inherit">${hsEscapeHtml(i.name)}</a></h4>
          <div class="unit">${hsMoney(i.price)} c/u · ${hsEscapeHtml(i.category)}</div>
          <div class="qty-selector mt-2" style="transform:scale(.9);transform-origin:left">
            <button type="button" data-dec="${i.id}">−</button>
            <input type="text" value="${i.qty}" data-qty="${i.id}" inputmode="numeric">
            <button type="button" data-inc="${i.id}">+</button>
          </div>
        </div>
        <div class="cart-item-actions">
          <strong class="price">${hsMoney(i.price * i.qty)}</strong>
          <button class="link-danger" data-remove="${i.id}">Eliminar</button>
        </div>
      </div>`).join("") + `</div>`;

    const subtotal = HS_CART.subtotal();
    const taxableBase = Math.round(subtotal / 1.19);
    const vat = subtotal - taxableBase;
    const shipping = shippingCop(items);
    const total = subtotal + shipping;
    summaryEl.innerHTML = `
      <h3>Resumen del pedido</h3>
      <div class="summary-row"><span>Subtotal de productos</span><span>${hsMoney(subtotal)}</span></div>
      <div class="summary-row"><span>Base gravable</span><span>${hsMoney(taxableBase)}</span></div>
      <div class="summary-row"><span>IVA incluido (19%)</span><span>${hsMoney(vat)}</span></div>
      <div class="summary-row"><span>Envío local en Barranquilla</span><span>${shipping ? hsMoney(shipping) : "Gratis"}</span></div>
      <div class="summary-row total"><span>Total</span><span>${hsMoney(total)}</span></div>
      <button class="btn btn--primary btn--block mt-3" id="checkoutBtn">${hsIcon("check")} ${HS_API.getSessionUser() ? "Pagar con PayPal" : "Ingresar para pagar"}</button>
      <div class="paypal-panel hidden" id="paypalPanel"><div class="paypal-conversion" id="paypalConversion"></div><div id="paypalButtons"></div></div>
      <p class="paypal-status" id="paypalStatus" aria-live="polite"></p>
      <p class="summary-note">Valores en pesos colombianos (COP). El IVA desglosado ya está incluido en el subtotal de productos; no se suma nuevamente. El envío fuera de Barranquilla y su área metropolitana se cotiza por separado.</p>`;

    document.getElementById("checkoutBtn").addEventListener("click", startPayPal);
  }

  listEl.addEventListener("click", (e) => {
    const dec = e.target.closest("[data-dec]");
    const inc = e.target.closest("[data-inc]");
    const rem = e.target.closest("[data-remove]");
    if (dec) { const it = HS_CART.get().find(x => x.id === dec.dataset.dec); HS_CART.setQty(dec.dataset.dec, it.qty - 1); render(); }
    if (inc) { const it = HS_CART.get().find(x => x.id === inc.dataset.inc); HS_CART.setQty(inc.dataset.inc, it.qty + 1); render(); }
    if (rem) { HS_CART.remove(rem.dataset.remove); hsToast("Producto eliminado del carrito"); render(); }
  });
  listEl.addEventListener("change", (e) => {
    const input = e.target.closest("[data-qty]");
    if (!input) return;
    HS_CART.setQty(input.dataset.qty, parseInt(input.value.replace(/\D/g, ""), 10) || 1);
    render();
  });
  document.addEventListener("hs:cart-updated", render);

  render();
}

/* ==================== CONTACTO ==================== */
function initContacto() {
  // Preseleccionar servicio si viene en la URL
  const svc = new URLSearchParams(location.search).get("servicio");
  const select = document.getElementById("contactService");
  select.innerHTML = `<option value="">Selecciona un servicio…</option>` +
    HS_DATA.services.map(s => `<option value="${s.id}">${s.title}</option>`).join("") +
    `<option value="otro">Otro / consulta general</option>`;
  if (svc) select.value = svc;

  document.getElementById("contactForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const button = form.querySelector("button[type=submit]");
    const status = document.getElementById("contactStatus");
    const name = document.getElementById("contactName").value.trim();
    button.disabled = true;
    button.textContent = "Enviando solicitud...";
    status.textContent = "Enviando tu solicitud al equipo de atención...";
    try {
      const result = await HS_API.request("/contact-requests", { method: "POST", body: JSON.stringify({ name, company: document.getElementById("contactCompany").value.trim() || undefined, email: document.getElementById("contactEmail").value.trim(), phone: document.getElementById("contactPhone").value.trim(), service: select.options[select.selectedIndex].textContent, message: document.getElementById("contactMsg").value.trim(), wantsPortalAccess: document.getElementById("contactPortalAccess").checked }) });
      form.reset();
      status.textContent = result.notification.requesterEmailSent ? "Solicitud enviada. Revisa tu correo para confirmar la recepción." : "Solicitud enviada. Nuestro equipo te contactará pronto.";
      hsToast(`Solicitud enviada. Gracias ${name}, te contactaremos pronto.`);
    } catch (error) {
      status.textContent = error.message || "No fue posible enviar la solicitud.";
      hsToast(status.textContent);
    } finally {
      button.disabled = false;
      button.textContent = "Enviar solicitud";
    }
  });

  // FAQ
  document.getElementById("faqList").innerHTML = HS_DATA.faqs.map((f, i) => `
    <div class="faq-item">
      <button class="faq-q" data-faq="${i}">${f.q} ${hsIcon("plus")}</button>
      <div class="faq-a"><p>${f.a}</p></div>
    </div>`).join("");
  document.getElementById("faqList").addEventListener("click", (e) => {
    const q = e.target.closest(".faq-q");
    if (!q) return;
    const item = q.parentElement;
    const answer = item.querySelector(".faq-a");
    const open = item.classList.toggle("is-open");
    answer.style.maxHeight = open ? answer.scrollHeight + "px" : "0";
  });
}

/* ==================== PORTAL DE SOPORTE (landing) ==================== */
function initSoporte() {
  document.getElementById("supportForm").addEventListener("submit", (e) => {
    e.preventDefault();
    window.location.href = "portal.html";
  });
}

/* ==================== VISTA CLIENTE ==================== */
function initCliente() {
  const tk = HS_DATA.clientTickets;
  const open = tk.filter(t => ["nuevo", "progreso", "pendiente"].includes(t.status)).length;

  // Tarjetas resumen
  document.getElementById("clientStats").innerHTML = `
    <div class="card stat-card"><div class="stat-icon tint-amber">${hsIcon("ticket")}</div>
      <div><strong>${open}</strong><span>Incidencias activas</span></div></div>
    <div class="card stat-card"><div class="stat-icon tint-green">${hsIcon("check")}</div>
      <div><strong>${tk.filter(t => t.status === "resuelto" || t.status === "cerrado").length}</strong><span>Servicios completados</span></div></div>
    <div class="card stat-card"><div class="stat-icon tint-red-teal">${hsIcon("laptop")}</div>
      <div><strong>${HS_DATA.devices.length}</strong><span>Equipos registrados</span></div></div>
    <div class="card stat-card"><div class="stat-icon tint-blue">${hsIcon("clock")}</div>
      <div><strong>24 h</strong><span>Tiempo medio de respuesta</span></div></div>`;

  // Mis incidencias
  document.getElementById("clientTickets").innerHTML = `
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>Ticket</th><th>Asunto</th><th>Equipo</th><th>Estado</th><th>Prioridad</th><th>Progreso</th><th>Actualizado</th></tr></thead>
      <tbody>
        ${tk.map(t => `
          <tr data-ticket="${t.id}" style="cursor:pointer">
            <td class="ticket-id">${t.id}</td>
            <td>${t.subject}</td>
            <td class="text-muted">${t.device}</td>
            <td>${hsStatusChip(t.status)}</td>
            <td>${hsPriorityChip(t.priority)}</td>
            <td><div class="progress-track"><div class="progress-fill" style="width:${t.progress}%"></div></div></td>
            <td class="text-muted">${t.updated}</td>
          </tr>`).join("")}
      </tbody>
    </table></div>
    <div id="ticketDetail" class="mt-3"></div>`;

  document.getElementById("clientTickets").addEventListener("click", (e) => {
    const row = e.target.closest("[data-ticket]");
    if (!row) return;
    const t = tk.find(x => x.id === row.dataset.ticket);
    document.getElementById("ticketDetail").innerHTML = `
      <div class="card panel" style="border-left:4px solid var(--hs-red-500)">
        <div class="flex-between">
          <h3>${t.id} — ${t.subject}</h3>
          ${hsStatusChip(t.status)}
        </div>
        <p class="text-muted mt-2">${t.note}</p>
        <p style="font-size:.82rem" class="text-muted mt-2">Abierto: ${t.opened} · Última actualización: ${t.updated}</p>
      </div>`;
  });

  // Equipos registrados
  document.getElementById("clientDevices").innerHTML = HS_DATA.devices.map(d => `
    <article class="card device-card">
      <div class="device-icon">${hsIcon(d.icon)}</div>
      <div>
        <div class="flex-between"><h4>${d.name}</h4></div>
        <div class="serial">${d.id} · S/N ${d.serial}</div>
        <div class="device-meta">${d.type} · Último servicio: ${d.lastService}</div>
        <span class="chip ${d.status === "operativo" ? "chip--stock" : d.status === "en servicio" ? "chip--progreso" : "chip--pendiente"} mt-2">${d.status}</span>
      </div>
    </article>`).join("");

  // Historial
  document.getElementById("clientHistory").innerHTML = `
    <ul class="timeline">
      ${HS_DATA.history.map(h => `
        <li class="${h.muted ? "is-muted" : ""}">
          <div class="t-date">${h.date}</div>
          <div class="t-title">${h.title}</div>
          <div class="t-desc">${h.desc}</div>
        </li>`).join("")}
    </ul>`;

  // Tabs
  initTabs("clientTabs", "clientPanel");
}

/* ==================== VISTA OPERADOR ==================== */
function initOperador() {
  const tickets = HS_DATA.tickets;
  let statusFilter = "todos";
  let priorityFilter = "todas";

  // Stats
  const byStatus = s => tickets.filter(t => t.status === s).length;
  document.getElementById("opStats").innerHTML = `
    <div class="card stat-card"><div class="stat-icon tint-blue">${hsIcon("ticket")}</div>
      <div><strong>${byStatus("nuevo")}</strong><span>Nuevos sin asignar</span></div></div>
    <div class="card stat-card"><div class="stat-icon tint-amber">${hsIcon("clock")}</div>
      <div><strong>${byStatus("progreso")}</strong><span>En progreso</span></div></div>
    <div class="card stat-card"><div class="stat-icon tint-violet">${hsIcon("gear")}</div>
      <div><strong>${byStatus("pendiente")}</strong><span>Pendientes</span></div></div>
    <div class="card stat-card"><div class="stat-icon tint-green">${hsIcon("check")}</div>
      <div><strong>${byStatus("resuelto") + byStatus("cerrado")}</strong><span>Resueltos / cerrados</span></div></div>`;

  function renderTable() {
    const list = tickets.filter(t =>
      (statusFilter === "todos" || t.status === statusFilter) &&
      (priorityFilter === "todas" || t.priority === priorityFilter));
    document.getElementById("opTicketRows").innerHTML = list.length ? list.map(t => `
      <tr>
        <td class="ticket-id">${t.id}</td>
        <td><strong>${t.subject}</strong><br><span class="text-muted" style="font-size:.8rem">${t.client} · ${t.device}</span></td>
        <td>${hsPriorityChip(t.priority)}</td>
        <td>
          <select data-status="${t.id}" aria-label="Cambiar estado">
            ${Object.entries(HS_TICKET_STATUS).map(([k, v]) =>
              `<option value="${k}" ${t.status === k ? "selected" : ""}>${v.label}</option>`).join("")}
          </select>
        </td>
        <td>
          <select data-assign="${t.id}" aria-label="Asignar técnico">
            <option value="">Sin asignar</option>
            ${HS_DATA.operators.map(o => `<option ${t.assignee === o ? "selected" : ""}>${o}</option>`).join("")}
          </select>
        </td>
        <td><div class="progress-track"><div class="progress-fill" style="width:${t.progress}%"></div></div></td>
      </tr>`).join("")
      : `<tr><td colspan="6" class="text-muted" style="text-align:center;padding:32px">No hay tickets con estos filtros.</td></tr>`;
  }

  document.getElementById("opStatusFilter").addEventListener("change", (e) => { statusFilter = e.target.value; renderTable(); });
  document.getElementById("opPriorityFilter").addEventListener("change", (e) => { priorityFilter = e.target.value; renderTable(); });

  // Cambios simulados de estado / asignación
  document.getElementById("opTicketRows").addEventListener("change", (e) => {
    const statusSel = e.target.closest("[data-status]");
    const assignSel = e.target.closest("[data-assign]");
    if (statusSel) {
      const t = tickets.find(x => x.id === statusSel.dataset.status);
      t.status = statusSel.value;
      t.progress = { nuevo: 10, pendiente: 40, progreso: 60, resuelto: 100, cerrado: 100 }[t.status];
      hsToast(`Ticket ${t.id} → ${HS_TICKET_STATUS[t.status].label} (demo)`);
    }
    if (assignSel) {
      const t = tickets.find(x => x.id === assignSel.dataset.assign);
      t.assignee = assignSel.value || null;
      hsToast(t.assignee ? `${t.id} asignado a ${t.assignee} (demo)` : `${t.id} quedó sin asignar`);
    }
    renderTable();
  });

  renderTable();

  // Inventario
  document.getElementById("opInventory").innerHTML = HS_DATA.inventory.map(i => {
    const level = i.stock <= 0 ? ["chip--agotado", "Agotado"] : i.stock < i.min ? ["chip--bajo", "Stock bajo"] : ["chip--stock", "OK"];
    return `<tr>
      <td class="ticket-id">${i.sku}</td>
      <td>${i.item}</td>
      <td class="text-muted">${i.category}</td>
      <td><strong>${i.stock}</strong> <span class="text-muted" style="font-size:.78rem">/ mín. ${i.min}</span></td>
      <td><span class="chip ${level[0]}">${level[1]}</span></td>
    </tr>`;
  }).join("");

  initTabs("opTabs", "opPanel");
}

/* ---------- Tabs genéricos ---------- */
function initTabs(tabsId, panelPrefix) {
  const tabs = document.getElementById(tabsId);
  tabs.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-tab]");
    if (!btn) return;
    tabs.querySelectorAll("[data-tab]").forEach(b => b.classList.toggle("is-active", b === btn));
    document.querySelectorAll(`[id^="${panelPrefix}-"]`).forEach(p =>
      p.classList.toggle("hidden", p.id !== `${panelPrefix}-${btn.dataset.tab}`));
  });
}

/* ==================== ADMINISTRACIÓN ==================== */
function initAdmin() {
  const KEY = "hs_admin_products_co_v2";
  let products;
  try { products = JSON.parse(localStorage.getItem(KEY)) || [...HS_DATA.products]; }
  catch { products = [...HS_DATA.products]; }

  const save = () => localStorage.setItem(KEY, JSON.stringify(products));

  function renderTable() {
    document.getElementById("adminProductRows").innerHTML = products.map(p => {
      const avail = hsAvailability(p.stock);
      return `<tr>
        <td class="ticket-id">${p.id}</td>
        <td>${p.name}<br><span class="text-muted" style="font-size:.78rem">${p.category}</span></td>
        <td>${hsMoney(p.price)}</td>
        <td>${p.stock}</td>
        <td><span class="chip ${avail.chip}">${avail.label}</span></td>
        <td>
          <button class="btn btn--ghost btn--sm" data-edit="${p.id}">${hsIcon("edit")} Editar</button>
          <button class="btn btn--ghost btn--sm" data-del="${p.id}" style="color:var(--hs-red)">${hsIcon("trash")}</button>
        </td>
      </tr>`;
    }).join("");
  }

  const form = document.getElementById("adminProductForm");
  const formTitle = document.getElementById("adminFormTitle");
  const cancelBtn = document.getElementById("adminCancelEdit");

  function resetForm() {
    form.reset();
    document.getElementById("apId").value = "";
    formTitle.textContent = "Agregar producto";
    cancelBtn.classList.add("hidden");
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const id = document.getElementById("apId").value;
    const data = {
      name: document.getElementById("apName").value.trim(),
      category: document.getElementById("apCategory").value,
      price: parseFloat(document.getElementById("apPrice").value) || 0,
      stock: parseInt(document.getElementById("apStock").value, 10) || 0,
    };
    if (!data.name) return;
    if (id) {
      const p = products.find(x => x.id === id);
      Object.assign(p, data);
      hsToast("Producto actualizado (demo)");
    } else {
      const newId = "P-" + String(Math.max(...products.map(p => parseInt(p.id.slice(2), 10))) + 1).padStart(3, "0");
      products.push({ id: newId, icon: "box", desc: "Descripción pendiente.", specs: {}, ...data });
      hsToast(`Producto ${newId} creado (demo)`);
    }
    save(); resetForm(); renderTable();
  });

  cancelBtn.addEventListener("click", resetForm);

  document.getElementById("adminProductRows").addEventListener("click", (e) => {
    const edit = e.target.closest("[data-edit]");
    const del = e.target.closest("[data-del]");
    if (edit) {
      const p = products.find(x => x.id === edit.dataset.edit);
      document.getElementById("apId").value = p.id;
      document.getElementById("apName").value = p.name;
      document.getElementById("apCategory").value = p.category;
      document.getElementById("apPrice").value = p.price;
      document.getElementById("apStock").value = p.stock;
      formTitle.textContent = `Editar ${p.id}`;
      cancelBtn.classList.remove("hidden");
      form.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    if (del) {
      products = products.filter(x => x.id !== del.dataset.del);
      save(); renderTable();
      hsToast("Producto eliminado (demo)");
    }
  });

  // Banners / contenido comercial simulado
  document.getElementById("adminBannerForm").addEventListener("submit", (e) => {
    e.preventDefault();
    hsToast("Contenido comercial actualizado (demo)");
  });

  initTabs("adminTabs", "adminPanel");
  renderTable();
}
