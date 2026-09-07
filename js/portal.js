document.addEventListener("DOMContentLoaded", () => {
  const state = { user: null, tickets: [], assets: [], operators: [], users: [], organizations: [], ticketClients: [], view: "dashboard", dashboardPeriod: "7d", customStart: "", customEnd: "", ticketFilters: { search: "", status: "", technician: "", category: "", period: "all", sort: "date" }, reportType: "", reportStatus: "all", statisticsFilters: { ticketStatus: "all", assetStatus: "all", period: "all" } };
  const login = document.getElementById("portalLogin");
  const app = document.getElementById("portalApp");
  const content = document.getElementById("portalView");
  const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  const date = value => value ? new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "-";
  const ticketCode = ticket => `TK-${String(ticket.ticket_number).padStart(5, "0")}`;
  const statusLabels = { open: "Abierto", in_progress: "En progreso", pending_customer: "Pendiente cliente", pending_parts: "Pendiente repuesto", resolved: "Resuelto", closed: "Cerrado" };
  const priorityLabels = { low: "Baja", medium: "Media", high: "Alta", urgent: "Urgente" };
  const closureCauseLabels = { hardware_failure: "Falla de hardware", software_issue: "Problema de software", configuration: "Configuración", user_guidance: "Orientación al usuario", preventive_maintenance: "Mantenimiento preventivo", parts_replacement: "Reemplazo de repuesto", network_issue: "Problema de red", security_incident: "Incidente de seguridad", other: "Otra causa" };
  const statusClass = { open: "chip--nuevo", in_progress: "chip--progreso", pending_customer: "chip--pendiente", pending_parts: "chip--pendiente", resolved: "chip--resuelto", closed: "chip--cerrado" };
  const dialogSnapshots = new WeakMap();

  function dialogFormState(dialog) {
    return [...dialog.querySelectorAll("input, select, textarea")].map(field => [field.id || field.name, field.type === "file" ? [...field.files].map(file => file.name) : field.value, field.checked]);
  }
  function showDialog(dialog) {
    dialogSnapshots.set(dialog, dialogFormState(dialog));
    dialog.showModal();
  }
  function hasDialogChanges(dialog) {
    return JSON.stringify(dialogSnapshots.get(dialog)) !== JSON.stringify(dialogFormState(dialog));
  }
  function closeDialogSafely(dialog) {
    if (!hasDialogChanges(dialog) || window.confirm("Hay información sin guardar. ¿Desea descartarla?")) dialog.close();
  }
  function showTicketCreated(ticket) {
    document.getElementById("ticketSuccessCode").textContent = ticketCode(ticket);
    document.getElementById("ticketSuccessMessage").textContent = "Tu solicitud quedó registrada y pronto será atendida por nuestro equipo.";
    const emailMessage = ticket.notification?.requesterEmailSent ? "Te enviamos una confirmación al correo registrado." : "La incidencia quedó registrada. No fue posible confirmar el envío del correo.";
    const staffMessage = ticket.notification?.staffEmailSent ? " El equipo técnico y administrativo ya recibió el aviso." : "";
    document.getElementById("ticketSuccessEmail").textContent = `${emailMessage}${staffMessage}`;
    showDialog(document.getElementById("ticketSuccessDialog"));
  }

  async function loadSession() {
    if (!HS_API.getToken()) return showLogin();
    try {
      const { user } = await HS_API.request("/me"); state.user = user; showApp(); await loadView(initialView());
    } catch { showLogin(); }
  }
  function initialView() {
    const view = new URLSearchParams(location.search).get("view");
    return ["dashboard", "tickets", "reports", "assets", "orders", "contacts", "organizations", "users", "commerce"].includes(view) ? view : "dashboard";
  }
  function returnToCheckout() {
    const target = sessionStorage.getItem("hs_return_to");
    if (!target || !/^carrito\.html(?:\?|$)/.test(target)) return false;
    sessionStorage.removeItem("hs_return_to");
    location.href = target;
    return true;
  }
  function showLogin() { login.classList.remove("hidden"); app.classList.add("hidden"); }
  function showApp() {
    login.classList.add("hidden"); app.classList.remove("hidden");
    document.getElementById("portalUserName").textContent = state.user.name;
    document.getElementById("portalUserRole").textContent = ({ client: "Cliente", agent: "Agente", supervisor: "Supervisor", admin: "Administrador" })[state.user.role];
    document.querySelectorAll(".admin-only").forEach(element => element.classList.toggle("hidden", state.user.role !== "admin"));
  }
  async function loadView(view) {
    state.view = view; content.innerHTML = '<div class="portal-loading">Cargando...</div>';
    document.getElementById("viewKicker").textContent = "Centro de servicio";
    document.getElementById("viewSubtitle").textContent = "";
    document.getElementById("viewTitle").textContent = ({ dashboard: `Buenos días, ${state.user.name}`, tickets: "Solicitudes", reports: "Reportes de servicio", assets: "Equipos registrados", orders: "Historial de compras", contacts: "Contactos de empresa", organizations: "Empresas registradas", users: "Usuarios y roles", commerce: "Catálogo y promociones" })[view];
    document.getElementById("newTicketBtn").classList.toggle("hidden", !["tickets", "dashboard"].includes(view));
    document.getElementById("dashboardPeriodControl").classList.toggle("hidden", view !== "dashboard");
    document.getElementById("manageRecordBtn").classList.toggle("hidden", state.user.role === "client" || ["tickets", "dashboard", "reports", "commerce"].includes(view));
    document.querySelectorAll("#portalNav [data-view]").forEach(button => button.classList.toggle("is-active", button.dataset.view === view));
    try {
      if (view === "dashboard") await renderDashboard();
      else if (view === "tickets") await renderTickets();
      else if (view === "reports") await renderReports();
      else if (view === "users") await renderUsers();
      else if (view === "commerce") await renderCommerce();
      else await renderCollection(view);
    } catch (error) { content.innerHTML = `<div class="empty-state"><h3>No fue posible cargar</h3><p>${escapeHtml(error.message)}</p></div>`; }
  }
  async function loadTicketData() {
    const canAssign = ["supervisor", "admin"].includes(state.user.role);
    const responses = await Promise.all([HS_API.request("/tickets"), HS_API.request("/assets"), canAssign ? HS_API.request("/operators") : Promise.resolve({ items: [] }), state.user.role === "client" ? Promise.resolve({ items: [] }) : HS_API.request("/ticket-clients")]);
    state.tickets = responses[0].items; state.assets = responses[1].items; state.operators = responses[2].items; state.ticketClients = responses[3].items;
  }
  async function renderTickets(loadData = true) {
    if (loadData) await loadTicketData();
    const active = state.tickets.filter(ticket => !["resolved", "closed"].includes(ticket.status)).length; const visibleTickets = filterTickets();
    document.getElementById("portalStats").innerHTML = `<div><strong>${state.tickets.length}</strong><span>Total</span></div><div><strong>${active}</strong><span>Activas</span></div><div><strong>${state.assets.length}</strong><span>Equipos</span></div>`;
    const technicianFilter = ["supervisor", "admin"].includes(state.user.role) ? `<select id="ticketTechnician"><option value="">Todos los técnicos</option>${state.operators.map(operator => `<option value="${operator.id}" ${state.ticketFilters.technician === operator.id ? "selected" : ""}>${escapeHtml(operator.full_name)}</option>`).join("")}</select>` : "";
    content.innerHTML = `<div class="ticket-filters"><input id="ticketSearch" type="search" placeholder="Buscar folio, cliente o equipo" value="${escapeHtml(state.ticketFilters.search)}"><select id="ticketStatus"><option value="">Todos los estados</option>${Object.entries(statusLabels).map(([value, label]) => `<option value="${value}" ${state.ticketFilters.status === value ? "selected" : ""}>${label}</option>`).join("")}</select>${technicianFilter}<select id="ticketCategory"><option value="">Todos los servicios</option>${[...new Set(state.tickets.map(ticket => ticket.category).filter(Boolean))].map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("")}</select><select id="ticketSort"><option value="date">Más recientes</option><option value="priority">Por urgencia</option><option value="age">Más antiguas</option></select></div>${visibleTickets.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Folio</th><th>Problema / cliente</th><th>Prioridad</th><th>Estado</th><th>Técnico</th><th>Actualizado</th></tr></thead><tbody>${visibleTickets.map(ticketRow).join("")}</tbody></table></div><div id="portalTicketDetail"></div>` : '<div class="empty-state"><h3>Sin solicitudes</h3><p>No hay registros que coincidan con los filtros.</p></div>'}`;
    syncTicketClientContext();
  }
  async function renderReports() {
    const reportTypes = {
      statistics: { title: "Estadísticas operativas", description: "Indicadores de atención, estados de tickets y activos con incidencias", endpoint: "/reports/statistics" },
      tickets: { title: "Reporte de tickets", description: "Estados, prioridades, responsables y cierres documentados", endpoint: "/reports" },
      assets: { title: "Reporte de equipos", description: "Inventario, propietarios, estado y ubicación de los activos", endpoint: "/assets" },
      orders: { title: "Reporte de compras", description: "Órdenes, estado de compra, fechas y valores registrados", endpoint: "/orders" },
      contacts: { title: "Reporte de contactos", description: "Directorio de contactos y responsables por empresa", endpoint: "/contacts" },
    };
    if (!state.reportType) {
      document.getElementById("viewSubtitle").textContent = "Selecciona la información que necesitas consultar";
      document.getElementById("portalStats").innerHTML = "";
      content.innerHTML = `<section class="report-home"><div class="report-home__intro"><span class="eyebrow">Centro de información</span><h2>¿Qué reporte necesitas?</h2><p>Elige un conjunto de datos para consultar sus registros autorizados.</p></div><div class="report-catalog">${Object.entries(reportTypes).map(([key, report]) => `<button class="report-choice" type="button" data-report-type="${key}"><span class="report-choice__icon" aria-hidden="true">${key === "tickets" ? "▤" : key === "assets" ? "▣" : key === "orders" ? "▥" : "◎"}</span><span><strong>${report.title}</strong><small>${report.description}</small></span><span class="report-choice__arrow" aria-hidden="true">→</span></button>`).join("")}</div></section>`;
      return;
    }
    const report = reportTypes[state.reportType];
    if (state.reportType === "statistics") return renderStatistics();
    if (state.reportType !== "tickets") {
      const { items } = await HS_API.request(report.endpoint);
      document.getElementById("viewSubtitle").textContent = report.description;
      document.getElementById("portalStats").innerHTML = `<div><strong>${items.length}</strong><span>Registros autorizados</span></div>`;
      const configs = {
        assets: { headers: ["Código", "Equipo", "Propietario", "Serie", "Estado", "Ubicación"], row: item => [item.asset_tag, [item.brand, item.model].filter(Boolean).join(" ") || item.asset_type, item.owner_name || "Sin asignar", item.serial_number || "-", item.status, item.location || "-"], fileName: item => `equipo-${item.asset_tag || item.id}` },
        orders: { headers: ["Orden", "Estado", "Fecha de compra", "Total", "Notas"], row: item => [`OC-${item.order_number}`, item.status, date(item.purchased_at), hsMoney(item.total_cop), item.notes || "-"], fileName: item => `compra-OC-${item.order_number || item.id}` },
        contacts: { headers: ["Nombre", "Cargo", "Correo", "Teléfono", "Principal"], row: item => [item.full_name, item.position || "-", item.email || "-", item.phone || "-", item.is_primary ? "Sí" : "No"], fileName: item => `contacto-${item.full_name || item.id}` },
      };
      const config = configs[state.reportType];
      content.innerHTML = `<div class="report-results-head"><button class="btn btn--ghost btn--sm" type="button" data-report-menu>← Reportes</button><div><span class="eyebrow">Consulta operativa</span><h2>${report.title}</h2></div></div>${items.length ? `<div class="table-wrap report-table-wrap"><table class="data-table report-table"><thead><tr>${config.headers.map(header => `<th>${header}</th>`).join("")}<th>Expediente</th></tr></thead><tbody>${items.map(item => `<tr>${config.row(item).map(value => `<td>${escapeHtml(value)}</td>`).join("")}<td><button class="btn btn--primary btn--sm report-download" type="button" data-report-record-type="${state.reportType}" data-report-record-id="${item.id}" data-report-record-name="${escapeHtml(config.fileName(item))}" title="Descargar expediente PDF"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"></path></svg><span>PDF</span></button></td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state"><h3>Sin registros</h3><p>No hay información autorizada para este reporte.</p></div>`}`;
      return;
    }
    const { items } = await HS_API.request("/reports");
    const scenarioLabels = { all: "Todos los escenarios", open: "Abiertos", in_progress: "En diagnóstico", pending: "Pendientes", resolved: "Resueltos", closed: "Cerrados" };
    const visibleItems = items.filter(item => state.reportStatus === "all" || (state.reportStatus === "pending" ? ["pending_customer", "pending_parts"].includes(item.status) : item.status === state.reportStatus));
    document.getElementById("viewSubtitle").textContent = "Matriz operativa de incidencias, seguimiento y cierres documentados";
    document.getElementById("portalStats").innerHTML = `<div><strong>${items.length}</strong><span>Total autorizados</span></div><div><strong>${items.filter(item => item.status === "closed").length}</strong><span>Cerrados</span></div><div><strong>${items.filter(item => !["resolved", "closed"].includes(item.status)).length}</strong><span>En atención</span></div><div><strong>${items.filter(item => item.priority === "urgent").length}</strong><span>Urgentes</span></div>`;
    content.innerHTML = `<div class="report-results-head"><button class="btn btn--ghost btn--sm" type="button" data-report-menu>← Reportes</button><div><span class="eyebrow">Matriz de escenarios</span><h2>Reporte de tickets</h2></div></div><div class="report-toolbar"><div><span class="eyebrow">Matriz de escenarios</span><strong>${scenarioLabels[state.reportStatus]}</strong></div><select id="reportStatusFilter" aria-label="Filtrar escenario">${Object.entries(scenarioLabels).map(([value, label]) => `<option value="${value}" ${state.reportStatus === value ? "selected" : ""}>${label}</option>`).join("")}</select></div>${visibleItems.length ? `<div class="table-wrap report-table-wrap"><table class="data-table report-table"><thead><tr><th>Informe</th><th>Solicitante / equipo</th><th>Escenario</th><th>Última actividad</th><th></th></tr></thead><tbody>${visibleItems.map(item => `<tr><td><strong>TK-${String(item.ticket_number).padStart(5, "0")}</strong><br><span class="text-muted">${escapeHtml(item.subject)}</span></td><td><strong>${escapeHtml(item.requester_name)}</strong><br><span class="text-muted">${escapeHtml(item.asset_tag ? `${item.asset_tag}${item.asset_name ? ` · ${item.asset_name}` : ""}` : "Sin equipo asociado")}</span></td><td><span class="chip ${statusClass[item.status]}">${item.status === "pending_customer" || item.status === "pending_parts" ? "Pendiente" : escapeHtml(statusLabels[item.status] || item.status)}</span></td><td>${date(item.closed_at || item.updated_at)}</td><td><button class="btn btn--primary btn--sm report-download" type="button" data-report-id="${item.id}" title="Descargar informe PDF"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"></path></svg><span>PDF</span></button></td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state"><h3>Sin incidencias en este escenario</h3><p>No hay registros autorizados para ${scenarioLabels[state.reportStatus].toLowerCase()}.</p></div>`}`;
  }
  async function renderStatistics() {
    const filters = state.statisticsFilters; const query = new URLSearchParams(filters); const data = await HS_API.request(`/reports/statistics?${query}`);
    const statusNames = { open: "Abiertos", in_progress: "En proceso", pending_customer: "Pendiente cliente", pending_parts: "Pendiente repuesto", resolved: "Resueltos", closed: "Cerrados" };
    const statusRows = data.tickets.byStatus; const activeTickets = statusRows.filter(item => !["resolved", "closed"].includes(item.status)).reduce((sum, item) => sum + item.count, 0); const closedTickets = statusRows.filter(item => item.status === "closed").reduce((sum, item) => sum + item.count, 0);
    document.getElementById("viewSubtitle").textContent = "Indicadores filtrables de atención e inventario";
    document.getElementById("portalStats").innerHTML = `<div><strong>${data.tickets.total}</strong><span>Tickets encontrados</span></div><div><strong>${activeTickets}</strong><span>En atención</span></div><div><strong>${closedTickets}</strong><span>Cerrados</span></div><div><strong>${data.assets.byStatus.active}</strong><span>Activos con incidencia</span></div>`;
    const barRows = rows => rows.length ? rows.map(item => `<div class="report-stat-row"><span>${escapeHtml(item.label)}</span><strong>${item.count}</strong><i><em style="width:${Math.min(100, item.count / Math.max(1, data.tickets.total) * 100)}%"></em></i></div>`).join("") : '<p class="text-muted">Sin registros para este filtro.</p>';
    const assetRows = [["Todos los activos", data.assets.byStatus.all], ["Con incidencias activas", data.assets.byStatus.active], ["Con incidencias cerradas", data.assets.byStatus.closed], ["Sin incidencias", data.assets.byStatus.none]].map(([label, count]) => ({ label, count }));
    content.innerHTML = `<div class="report-results-head"><button class="btn btn--ghost btn--sm" type="button" data-report-menu>← Reportes</button><div><span class="eyebrow">Centro de indicadores</span><h2>Estadísticas operativas</h2></div><button class="btn btn--primary btn--sm report-download" type="button" data-statistics-pdf title="Descargar estadísticas PDF"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"></path></svg><span>PDF</span></button></div><div class="report-toolbar statistics-toolbar"><select id="statisticsTicketStatus" aria-label="Filtrar tickets"><option value="all">Todos los tickets</option><option value="open">Abiertos</option><option value="in_progress">En proceso</option><option value="pending">Pendientes</option><option value="resolved">Resueltos</option><option value="closed">Cerrados</option></select><select id="statisticsAssetStatus" aria-label="Filtrar activos"><option value="all">Todos los activos</option><option value="active">Con incidencias activas</option><option value="closed">Con incidencias cerradas</option><option value="none">Sin incidencias</option></select><select id="statisticsPeriod" aria-label="Filtrar periodo"><option value="all">Todo el historial</option><option value="today">Hoy</option><option value="7d">Últimos 7 días</option><option value="30d">Últimos 30 días</option></select></div><div class="dashboard-charts statistics-grid"><section class="dashboard-panel"><div class="panel-head"><div><span class="eyebrow">Tickets</span><h2>Tickets por estado operativo</h2></div><strong>${data.tickets.total}</strong></div><div class="report-stat-list">${barRows(statusRows.map(item => ({ label: statusNames[item.status] || item.status, count: item.count })))}</div></section><section class="dashboard-panel"><div class="panel-head"><div><span class="eyebrow">Equipos</span><h2>Equipos por situación de incidencia</h2></div><strong>${data.assets.items.length}</strong></div><div class="report-stat-list">${barRows(assetRows)}</div></section></div><section class="dashboard-panel statistics-records"><div class="panel-head"><div><span class="eyebrow">Detalle filtrado</span><h2>Tickets registrados</h2></div><span class="text-muted">${data.tickets.items.length} registros</span></div>${data.tickets.items.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Número de ticket</th><th>Descripción / activo afectado</th><th>Estado operativo</th><th>Nivel de prioridad</th><th>Fecha de registro</th></tr></thead><tbody>${data.tickets.items.map(ticket => `<tr><td class="ticket-id">TK-${String(ticket.ticket_number).padStart(5, "0")}</td><td><strong>${escapeHtml(ticket.subject)}</strong><br><span class="text-muted">${escapeHtml(ticket.asset_tag || ticket.asset_name || "Sin equipo")}</span></td><td><span class="chip ${statusClass[ticket.status]}">${escapeHtml(statusNames[ticket.status] || ticket.status)}</span></td><td>${escapeHtml(priorityLabels[ticket.priority] || ticket.priority || "-")}</td><td>${date(ticket.created_at)}</td></tr>`).join("")}</tbody></table></div>` : '<div class="empty-state"><h3>Sin tickets para este filtro</h3><p>No hay registros que coincidan con el estado o periodo seleccionado.</p></div>'}</section><section class="dashboard-panel"><div class="panel-head"><div><span class="eyebrow">Detalle filtrado</span><h2>Equipos registrados</h2></div><span class="text-muted">${data.assets.items.length} registros</span></div>${data.assets.items.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Código del equipo</th><th>Descripción del equipo</th><th>Incidencias registradas</th><th>Incidencias activas</th><th>Incidencias cerradas</th></tr></thead><tbody>${data.assets.items.map(asset => `<tr><td class="ticket-id">${escapeHtml(asset.asset_tag)}</td><td>${escapeHtml([asset.brand, asset.model].filter(Boolean).join(" ") || asset.asset_type || "Equipo")}</td><td>${asset.incident_count}</td><td>${asset.active_incidents}</td><td>${asset.closed_incidents}</td></tr>`).join("")}</tbody></table></div>` : '<div class="empty-state"><h3>Sin equipos para este filtro</h3><p>No hay equipos que coincidan con la clasificación seleccionada.</p></div>'}</section>`;
    document.getElementById("statisticsTicketStatus").value = filters.ticketStatus; document.getElementById("statisticsAssetStatus").value = filters.assetStatus; document.getElementById("statisticsPeriod").value = filters.period;
  }
  async function downloadReport(button) {
    const original = button.innerHTML; button.disabled = true; button.innerHTML = "Generando...";
    try { const blob = await HS_API.requestBlob(`/reports/${button.dataset.reportId}.pdf`, "No fue posible generar el reporte PDF"); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `reporte-${button.closest("tr").querySelector("strong").textContent}.pdf`; link.click(); URL.revokeObjectURL(url); hsToast("Reporte PDF generado"); }
    catch (error) { hsToast(error.message); }
    finally { button.disabled = false; button.innerHTML = original; }
  }
  async function downloadCollectionReport(button) {
    const original = button.innerHTML; button.disabled = true; button.innerHTML = "Generando...";
    try { const blob = await HS_API.requestBlob(`/reports/collection/${button.dataset.reportTypeDownload}.pdf`, "No fue posible generar el reporte PDF"); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `reporte-${button.dataset.reportTypeDownload}.pdf`; link.click(); URL.revokeObjectURL(url); hsToast("Reporte PDF generado"); }
    catch (error) { hsToast(error.message); }
    finally { button.disabled = false; button.innerHTML = original; }
  }
  async function downloadRecordReport(button) {
    const original = button.innerHTML; button.disabled = true; button.innerHTML = "Generando...";
    try { const blob = await HS_API.requestBlob(`/reports/collection/${button.dataset.reportRecordType}/${button.dataset.reportRecordId}.pdf`, "No fue posible generar el expediente PDF"); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `${button.dataset.reportRecordName || `expediente-${button.dataset.reportRecordType}`}.pdf`; link.click(); URL.revokeObjectURL(url); hsToast("Expediente PDF generado"); }
    catch (error) { hsToast(error.message); }
    finally { button.disabled = false; button.innerHTML = original; }
  }
  async function downloadStatisticsReport(button) {
    const original = button.innerHTML; button.disabled = true; button.innerHTML = "Generando...";
    try { const query = new URLSearchParams(state.statisticsFilters); const blob = await HS_API.requestBlob(`/reports/statistics.pdf?${query}`, "No fue posible generar las estadísticas PDF"); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `estadisticas-operativas-${state.statisticsFilters.period}.pdf`; link.click(); URL.revokeObjectURL(url); hsToast("Estadísticas PDF generadas"); }
    catch (error) { hsToast(error.message); }
    finally { button.disabled = false; button.innerHTML = original; }
  }
  function filterTickets() { const { search, status, technician, category, sort } = state.ticketFilters; const query = search.toLowerCase(); const list = state.tickets.filter(ticket => (!query || [ticket.ticket_number, ticket.subject, ticket.organization_name, ticket.asset_name].some(value => String(value || "").toLowerCase().includes(query))) && (!status || ticket.status === status) && (!technician || ticket.assigned_to === technician) && (!category || ticket.category === category)); return list.sort((a, b) => sort === "priority" ? ticketPriorityScore(a) - ticketPriorityScore(b) : sort === "age" ? new Date(a.created_at) - new Date(b.created_at) : new Date(b.updated_at) - new Date(a.updated_at)); }
  function periodStart() {
    if (state.dashboardPeriod === "custom" && state.customStart) return new Date(`${state.customStart}T00:00:00`);
    const days = state.dashboardPeriod === "today" ? 1 : state.dashboardPeriod === "30d" ? 30 : 7;
    const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - (days - 1)); return start;
  }
  function periodTickets() { const start = periodStart(); const end = state.dashboardPeriod === "custom" && state.customEnd ? new Date(`${state.customEnd}T23:59:59`) : null; return state.tickets.filter(ticket => new Date(ticket.created_at) >= start && (!end || new Date(ticket.created_at) <= end)); }
  function ticketPriorityScore(ticket) { return { urgent: 0, high: 1, medium: 2, low: 3 }[ticket.priority] ?? 4; }
  function statusText(status) { return statusLabels[status] || status; }
  function chartBars(tickets) {
    const periodDays = state.dashboardPeriod === "today" ? 1 : state.dashboardPeriod === "30d" ? 30 : 7;
    const bucketCount = state.dashboardPeriod === "today" ? 1 : 7;
    const bucketSize = Math.ceil(periodDays / bucketCount);
    const periodStartDate = periodStart();
    const buckets = Array.from({ length: bucketCount }, (_, index) => { const start = new Date(periodStartDate); start.setDate(start.getDate() + index * bucketSize); const end = new Date(start); end.setDate(end.getDate() + bucketSize); return { label: start.toLocaleDateString("es-CO", { day: "2-digit", month: "short" }), start, end, received: 0, resolved: 0 }; });
    tickets.forEach(ticket => { const created = new Date(ticket.created_at); const bucket = buckets.find(item => created >= item.start && created < item.end); if (bucket) { bucket.received++; if (["resolved", "closed"].includes(ticket.status)) bucket.resolved++; } });
    const max = Math.max(1, ...buckets.map(item => Math.max(item.received, item.resolved))); const width = 760; const height = 250; const left = 52; const right = 25; const top = 28; const bottom = 57; const chartWidth = width - left - right; const chartHeight = height - top - bottom; const step = chartWidth / Math.max(1, buckets.length - 1); const y = value => top + chartHeight - value / max * chartHeight;
    const points = key => buckets.map((item, index) => `${left + index * step} ${y(item[key])}`);
    const receivedPoints = points("received"); const resolvedPoints = points("resolved"); const receivedPath = receivedPoints.map((point, index) => `${index ? "L" : "M"}${point}`).join(" "); const resolvedPath = resolvedPoints.map((point, index) => `${index ? "L" : "M"}${point}`).join(" "); const areaPath = `${receivedPath} L${left + chartWidth} ${top + chartHeight} L${left} ${top + chartHeight} Z`;
    const scale = Array.from({ length: 4 }, (_, index) => Math.round(max * (3 - index) / 3));
    return `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Solicitudes recibidas y resueltas"><defs><linearGradient id="receivedAreaGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d71920" stop-opacity=".16"></stop><stop offset="1" stop-color="#d71920" stop-opacity="0"></stop></linearGradient></defs>${scale.map((value, index) => `<line class="chart-grid-line" x1="${left}" y1="${top + index * chartHeight / 3}" x2="${left + chartWidth}" y2="${top + index * chartHeight / 3}"></line><text class="chart-axis-text" x="${left - 20}" y="${top + index * chartHeight / 3 + 4}" text-anchor="end">${value}</text>`).join("")}<path class="received-area" d="${areaPath}"></path><path class="chart-line chart-line--received" d="${receivedPath}"></path><path class="chart-line chart-line--resolved" d="${resolvedPath}"></path>${receivedPoints.map(point => `<circle class="chart-dot chart-dot--received" cx="${point.split(" ")[0]}" cy="${point.split(" ")[1]}" r="4"></circle>`).join("")}${resolvedPoints.map(point => `<circle class="chart-dot chart-dot--resolved" cx="${point.split(" ")[0]}" cy="${point.split(" ")[1]}" r="4"></circle>`).join("")}${buckets.map((item, index) => `<text class="chart-axis-text" x="${left + index * step}" y="${height - 18}" text-anchor="middle">${item.label}</text>`).join("")}</svg><div class="chart-legend"><span><i class="legend-dot legend-dot--received"></i>Recibidas</span><span><i class="legend-dot legend-dot--resolved"></i>Resueltas</span></div>`;
  }
  function statusChart(tickets) { const groups = [["open", "Sin revisar"], ["in_progress", "En diagnóstico"], ["pending", "Esperando respuesta o repuesto"], ["resolved", "Listo para entregar"], ["closed", "Cerrado"]]; const total = Math.max(1, tickets.length); return `<div class="status-chart">${groups.map(([key, label]) => { const count = tickets.filter(ticket => key === "pending" ? ["pending_customer", "pending_parts"].includes(ticket.status) : ticket.status === key).length; return `<div class="status-bar"><div><span>${label}</span><strong>${count}</strong></div><span class="status-track"><i style="width:${count / total * 100}%"></i></span></div>`; }).join("")}</div>`; }
  function attentionRows(tickets) { const rows = tickets.filter(ticket => !["resolved", "closed"].includes(ticket.status)).sort((a, b) => ticketPriorityScore(a) - ticketPriorityScore(b) || new Date(a.created_at) - new Date(b.created_at)).slice(0, 8); return rows.length ? rows.map(ticket => `<tr data-ticket-id="${ticket.id}"><td class="ticket-id">${ticketCode(ticket)}</td><td><strong>${escapeHtml(ticket.subject)}</strong><br><span class="text-muted">${escapeHtml(ticket.organization_name || "Cliente estándar")}</span></td><td>${escapeHtml(ticket.asset_name || "Sin equipo")}</td><td><span class="chip ${statusClass[ticket.status]}">${statusText(ticket.status)}</span></td><td>${escapeHtml(ticket.assigned_name || "Sin asignar")}</td><td>${date(ticket.created_at)}</td><td><button class="btn btn--ghost btn--sm" type="button">Abrir</button></td></tr>`).join("") : '<tr><td colspan="7" class="table-empty">No hay solicitudes pendientes de atención.</td></tr>'; }
  function clientTicketRows(tickets) { const rows = [...tickets].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)); return rows.length ? rows.map(ticket => `<tr data-ticket-id="${ticket.id}"><td class="ticket-id">${ticketCode(ticket)}</td><td><strong>${escapeHtml(ticket.subject)}</strong><br><span class="text-muted">${escapeHtml(ticket.asset_name || "Sin equipo asociado")}</span></td><td><span class="chip ${statusClass[ticket.status]}">${statusText(ticket.status)}</span></td><td>${escapeHtml(ticket.assigned_name || "En asignación")}</td><td>${date(ticket.updated_at)}</td></tr>`).join("") : '<tr><td colspan="5" class="table-empty">Aún no tienes incidencias registradas.</td></tr>'; }
  async function renderDashboard() {
    await loadTicketData(); const tickets = periodTickets(); const active = tickets.filter(ticket => !["resolved", "closed"].includes(ticket.status)); const urgent = active.filter(ticket => ticket.priority === "urgent"); const resolved = tickets.filter(ticket => ["resolved", "closed"].includes(ticket.status));
    if (state.user.role === "client") {
      const allTickets = state.tickets; const allActive = allTickets.filter(ticket => !["resolved", "closed"].includes(ticket.status)); const allResolved = allTickets.filter(ticket => ["resolved", "closed"].includes(ticket.status)); const allUrgent = allActive.filter(ticket => ticket.priority === "urgent");
      document.getElementById("viewSubtitle").textContent = "Consulta el estado y seguimiento de tus incidencias";
      document.getElementById("portalStats").innerHTML = `<div class="dashboard-stat"><span class="stat-icon"><svg viewBox="0 0 24 24"><path d="M4 5h16v14H4z"></path><path d="M8 9h8M8 13h6"></path></svg></span><strong>${allTickets.length}</strong><small>Mis incidencias</small><em>${allTickets.length ? "Registradas" : "Sin registros"}</em></div><div class="dashboard-stat"><span class="stat-icon stat-icon--alert"><svg viewBox="0 0 24 24"><path d="M12 3 2.8 20h18.4L12 3Z"></path><path d="M12 9v5M12 17.5v.5"></path></svg></span><strong>${allActive.length}</strong><small>En seguimiento</small><em>${allActive.length ? "Atención en curso" : "Sin pendientes"}</em></div><div class="dashboard-stat"><span class="stat-icon stat-icon--wait"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg></span><strong>${allUrgent.length}</strong><small>Prioridad urgente</small><em>${allUrgent.length ? "Revisa el seguimiento" : "Sin urgencias"}</em></div><div class="dashboard-stat"><span class="stat-icon stat-icon--done"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"></circle><path d="m8 12 2.5 2.5L16 9"></path></svg></span><strong>${allResolved.length}</strong><small>Resueltas</small><em>${allResolved.length ? "Cierre documentado" : "Aún sin cierres"}</em></div>`;
      content.innerHTML = `<div class="dashboard-charts"><section class="dashboard-panel"><div class="panel-head"><div><h2>Actividad de mis incidencias</h2><p class="text-muted">Registros y cierres durante el periodo</p></div></div>${chartBars(tickets)}</section><section class="dashboard-panel"><div class="panel-head"><div><h2>Estado de mis incidencias</h2><p class="text-muted">Seguimiento actual de tus solicitudes</p></div></div>${statusChart(allTickets)}</section></div><section class="dashboard-panel attention-panel"><div class="panel-head"><div><h2>Mis incidencias</h2><p class="text-muted">Consulta el avance de cada solicitud registrada</p></div><button class="btn btn--ghost btn--sm" type="button" data-view-link="tickets">Ver todas</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Folio</th><th>Problema / equipo</th><th>Estado</th><th>Técnico</th><th>Actualizada</th></tr></thead><tbody>${clientTicketRows(allTickets)}</tbody></table></div><div id="portalTicketDetail"></div></section>`;
      return;
    }
    document.getElementById("viewSubtitle").textContent = "Esto requiere tu atención hoy"; document.getElementById("portalStats").innerHTML = `<div class="dashboard-stat"><span class="stat-icon"><svg viewBox="0 0 24 24"><path d="M4 5h16v14H4z"></path><path d="M8 9h8M8 13h6"></path></svg></span><strong>${active.length}</strong><small>Solicitudes activas</small><em>${active.length ? "En seguimiento" : "Sin pendientes"}</em></div><div class="dashboard-stat"><span class="stat-icon stat-icon--alert"><svg viewBox="0 0 24 24"><path d="M12 3 2.8 20h18.4L12 3Z"></path><path d="M12 9v5M12 17.5v.5"></path></svg></span><strong>${urgent.length}</strong><small>Casos urgentes</small><em>${urgent.length ? "Prioridad inmediata" : "No hay urgentes"}</em></div><div class="dashboard-stat"><span class="stat-icon stat-icon--wait"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg></span><strong>0</strong><small>Próximas a vencer</small><em>Sin fecha límite registrada</em></div><div class="dashboard-stat"><span class="stat-icon stat-icon--done"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"></circle><path d="m8 12 2.5 2.5L16 9"></path></svg></span><strong>${resolved.length}</strong><small>Resueltas en el periodo</small><em>${resolved.length ? "Cierre documentado" : "Aún sin cierres"}</em></div>`;
    content.innerHTML = `<div class="dashboard-charts"><section class="dashboard-panel"><div class="panel-head"><div><h2>Actividad de solicitudes</h2><p class="text-muted">Recibidas y resueltas en el periodo</p></div></div>${chartBars(tickets)}</section><section class="dashboard-panel"><div class="panel-head"><div><h2>Distribución por estado</h2><p class="text-muted">Carga operativa actual</p></div></div>${statusChart(tickets)}</section></div><section class="dashboard-panel attention-panel"><div class="panel-head"><div><h2>Requieren atención</h2><p class="text-muted">Urgencia primero, después antigüedad</p></div><button class="btn btn--ghost btn--sm" type="button" data-view-link="tickets">Ver todas</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Folio</th><th>Problema / cliente</th><th>Equipo</th><th>Estado</th><th>Técnico</th><th>Recibida</th><th></th></tr></thead><tbody>${attentionRows(tickets)}</tbody></table></div></section>`;
  }
  function syncTicketClientContext() {
    const clientSelect = document.getElementById("ticketClient");
    const isStaff = state.user.role !== "client";
    document.querySelector(".ticket-client-field").classList.toggle("hidden", !isStaff);
    document.getElementById("ticketClientCurrent").classList.toggle("hidden", isStaff);
    if (!isStaff) document.getElementById("ticketClientCurrentName").textContent = state.user.name;
    if (isStaff) populateTicketClientOptions(document.getElementById("ticketClientSearch")?.value || "", clientSelect.value);
    const selectedClient = state.ticketClients.find(client => client.id === clientSelect.value);
    refreshTicketAssets(isStaff ? selectedClient?.id || null : state.user.sub);
  }
  function populateTicketClientOptions(query = "", selectedId = "") {
    const clientSelect = document.getElementById("ticketClient");
    const normalizedQuery = query.trim().toLowerCase();
    const clients = state.ticketClients.filter(client => !normalizedQuery || [client.full_name, client.email, client.phone, client.organization_name].some(value => String(value || "").toLowerCase().includes(normalizedQuery)) || client.id === selectedId);
    if (normalizedQuery && clients.length === 1) selectedId = clients[0].id;
    clientSelect.innerHTML = `<option value="">${normalizedQuery && !clients.length ? "Sin clientes encontrados" : "Seleccione un cliente"}</option>` + clients.map(client => `<option value="${client.id}" ${client.id === selectedId ? "selected" : ""}>${escapeHtml(client.full_name)}${client.email ? ` · ${escapeHtml(client.email)}` : ""}</option>`).join("");
    clientSelect.value = selectedId || "";
  }
  function refreshTicketAssets(ownerUserId) {
    const assetSelect = document.getElementById("ticketAsset");
    const count = document.getElementById("ticketAssetCount");
    const assets = state.assets.filter(asset => asset.owner_user_id === ownerUserId);
    assetSelect.innerHTML = ownerUserId ? '<option value="">Sin equipo asociado</option>' + assets.map(asset => `<option value="${asset.id}">${escapeHtml(asset.asset_tag)} - ${escapeHtml([asset.brand, asset.model].filter(Boolean).join(" "))}</option>`).join("") : '<option value="">Sin equipo asociado</option>';
    assetSelect.disabled = !ownerUserId;
    count.textContent = ownerUserId ? `${assets.length} equipo${assets.length === 1 ? "" : "s"} disponible${assets.length === 1 ? "" : "s"}` : "Cliente sin inventario";
  }
  function openTicketDialog() {
    const form = document.getElementById("ticketForm"); form.reset();
    document.getElementById("ticketError").classList.add("hidden");
    const clientSelect = document.getElementById("ticketClient");
    document.getElementById("ticketClientSearch").value = "";
    if (state.user.role === "client") clientSelect.innerHTML = '<option value=""></option>'; else populateTicketClientOptions();
    syncTicketClientContext(); showDialog(document.getElementById("ticketDialog"));
  }
  function ticketRow(ticket) {
    const canUpdate = state.user.role !== "client";
    const canAssign = ["supervisor", "admin"].includes(state.user.role);
    const status = canUpdate ? `<select data-status="${ticket.id}">${Object.entries(statusLabels).map(([key, label]) => `<option value="${key}" ${key === ticket.status ? "selected" : ""}>${label}</option>`).join("")}</select>` : `<span class="chip ${statusClass[ticket.status]}">${statusLabels[ticket.status]}</span>`;
    const assigned = canAssign ? `<select data-assignee="${ticket.id}"><option value="">Sin asignar</option>${state.operators.map(operator => `<option value="${operator.id}" ${operator.id === ticket.assigned_to ? "selected" : ""}>${escapeHtml(operator.full_name)}</option>`).join("")}</select>` : escapeHtml(ticket.assigned_name || "Sin asignar");
    return `<tr data-ticket-id="${ticket.id}"><td class="ticket-id">${ticketCode(ticket)}</td><td><strong>${escapeHtml(ticket.subject)}</strong><br><span class="text-muted">${escapeHtml(ticket.organization_name || "Cliente estándar")}${ticket.asset_name ? ` · ${escapeHtml(ticket.asset_name)}` : ""}</span></td><td>${priorityLabels[ticket.priority]}</td><td>${status}</td><td>${assigned}</td><td>${date(ticket.updated_at)}</td></tr>`;
  }
  async function showTicket(id) {
    const ticket = state.tickets.find(item => item.id === id); if (!ticket) return;
    const [comments, events] = await Promise.all([HS_API.request(`/tickets/${id}/comments`), HS_API.request(`/tickets/${id}/events`)]);
    const commentsMarkup = comments.items.length ? comments.items.map(comment => { const requesterComment = comment.author_id === ticket.requester_id; return `<article class="comment ${requesterComment ? "comment--requester" : "comment--support"} ${comment.is_internal ? "is-internal" : ""}"><div class="comment__head"><strong>${escapeHtml(comment.author)}</strong><span>${date(comment.created_at)}${comment.is_internal ? " · Nota interna" : ""}</span></div><p>${escapeHtml(comment.body)}</p>${comment.attachments.length ? `<div class="comment-images">${comment.attachments.map(attachment => `<a class="comment-image" data-attachment-id="${attachment.id}" data-attachment-name="${escapeHtml(attachment.name)}" target="_blank" rel="noopener"><span>Cargando imagen...</span></a>`).join("")}</div>` : ""}</article>`; }).join("") : '<p class="ticket-detail__empty">Sin comentarios todavía.</p>';
    const eventsMarkup = events.items.length ? events.items.map(event => `<li class="${event.event_type === "closed" ? "timeline-event--closed" : event.event_type === "reopened" ? "timeline-event--reopened" : ""}"><div class="t-date">${date(event.created_at)}</div><div class="t-title">${event.event_type === "created" ? "Ticket creado" : event.event_type === "closed" ? "Ticket cerrado con soporte" : event.event_type === "reopened" ? "Ticket reabierto con soporte" : "Ticket actualizado"}</div><div class="t-desc">${escapeHtml(event.actor || "Sistema")}</div></li>`).join("") : '<li class="is-muted"><div class="t-title">Sin movimientos registrados</div></li>';
    document.getElementById("portalTicketDetail").innerHTML = `<section class="ticket-detail"><header class="ticket-detail__header"><div><span class="ticket-detail__code">${ticketCode(ticket)}</span><h2>${escapeHtml(ticket.subject)}</h2><p>${escapeHtml(ticket.description)}</p></div><span class="chip ${statusClass[ticket.status]}">${statusLabels[ticket.status]}</span></header><div class="ticket-detail__grid"><section class="ticket-detail__main" aria-labelledby="conversationTitle"><div class="ticket-detail__section-head"><div><span>Seguimiento</span><h3 id="conversationTitle">Conversación y evidencias</h3></div><strong>${comments.items.length}</strong></div><div class="comment-list">${commentsMarkup}</div><form class="ticket-composer" data-comment-form="${id}"><div class="field"><label>Agregar comentario</label><textarea required placeholder="Escribe una actualización del caso..."></textarea></div><div class="ticket-composer__footer"><div class="field attachment-input"><label>Adjuntar evidencias</label><input type="file" accept="image/jpeg,image/png,image/webp" multiple data-comment-images><span class="field-help">Máximo 4 imágenes de 8 MB.</span></div><div class="ticket-composer__actions">${state.user.role !== "client" ? '<label class="check-line"><input type="checkbox"> Nota interna</label>' : ""}<button class="btn btn--primary btn--sm">Publicar</button></div></div></form></section><aside class="ticket-trace" aria-labelledby="traceTitle"><div class="ticket-detail__section-head"><div><span>Auditoría</span><h3 id="traceTitle">Trazabilidad</h3></div><strong>${events.items.length}</strong></div><div class="ticket-trace__scroll"><ul class="timeline">${eventsMarkup}</ul></div></aside></div></section>`;
    await loadCommentImages();
  }
  async function openTicket(id) {
    if (state.view !== "tickets") await loadView("tickets");
    await showTicket(id);
    document.getElementById("portalTicketDetail")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  async function loadCommentImages() {
    await Promise.all([...document.querySelectorAll("[data-attachment-id]")].map(async link => {
      try { const blob = await HS_API.requestBlob(`/attachments/${link.dataset.attachmentId}`); const url = URL.createObjectURL(blob); const image = new Image(); image.src = url; image.alt = link.dataset.attachmentName; link.href = url; link.replaceChildren(image); }
      catch { link.textContent = "Imagen no disponible"; }
    }));
  }
  async function uploadImages(ticketId, commentId, files) {
    if (files.length > 4) throw new Error("Puede adjuntar máximo 4 imágenes por comentario");
    for (const file of files) { const formData = new FormData(); formData.append("image", file); await HS_API.request(`/tickets/${ticketId}/comments/${commentId}/attachments`, { method: "POST", body: formData }); }
  }
  function openClosureDialog(ticketId) {
    const form = document.getElementById("closureForm"); form.reset(); document.getElementById("closureTicketId").value = ticketId; document.getElementById("closureError").classList.add("hidden"); showDialog(document.getElementById("closureDialog"));
  }
  function openReopenDialog(ticketId) {
    const form = document.getElementById("reopenForm"); form.reset(); document.getElementById("reopenTicketId").value = ticketId; document.getElementById("reopenError").classList.add("hidden"); showDialog(document.getElementById("reopenDialog"));
  }
  async function renderUsers() {
    const [usersResponse, organizationsResponse] = await Promise.all([HS_API.request("/users"), HS_API.request("/organizations")]);
    state.users = usersResponse.items; state.organizations = organizationsResponse.items;
    const totals = { active: 0, suspended: 0, disabled: 0 }; state.users.forEach(user => totals[user.account_status]++);
    document.getElementById("portalStats").innerHTML = `<div><strong>${state.users.length}</strong><span>Total</span></div><div><strong>${totals.active}</strong><span>Activos</span></div><div><strong>${totals.suspended + totals.disabled}</strong><span>Restringidos</span></div>`;
    const roleLabels = { client: "Cliente", agent: "Técnico", supervisor: "Supervisor", admin: "Administrador" };
    const accountLabels = { active: "Activo", suspended: "Suspendido", disabled: "Inhabilitado" };
    const accountClasses = { active: "chip--resuelto", suspended: "chip--suspended", disabled: "chip--disabled" };
    content.innerHTML = state.users.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Usuario</th><th>Empresa</th><th>Rol</th><th>Estado</th><th>Último acceso</th><th>Acciones</th></tr></thead><tbody>${state.users.map(user => `<tr><td><strong>${escapeHtml(user.full_name)}</strong><br><span class="text-muted">${escapeHtml(user.email)}${user.phone ? ` · ${escapeHtml(user.phone)}` : ""}</span></td><td>${escapeHtml(user.organization_name || "-")}</td><td>${roleLabels[user.role]}</td><td><div class="user-status"><span class="chip ${accountClasses[user.account_status]}">${accountLabels[user.account_status]}</span>${user.account_status === "suspended" ? `<small>Hasta ${date(user.suspended_until)}</small>` : user.status_reason ? `<small>${escapeHtml(user.status_reason)}</small>` : ""}</div></td><td>${date(user.last_login_at)}</td><td><div class="user-actions"><button class="btn btn--ghost btn--sm" type="button" data-edit-user="${user.id}">Editar</button><button class="btn btn--ghost btn--sm" type="button" data-status-user="${user.id}">Gestionar estado</button>${user.id !== state.user.id ? `<button class="btn btn--ghost btn--sm" type="button" data-delete-user="${user.id}">Eliminar</button>` : ""}</div></td></tr>`).join("")}</tbody></table></div>` : '<div class="empty-state"><h3>Sin usuarios</h3><p>No hay cuentas registradas.</p></div>';
  }
  async function deleteUser(userId) {
    const user = state.users.find(item => item.id === userId); if (!user || !confirm(`¿Eliminar definitivamente a ${user.full_name}? Esta acción no se puede deshacer.`)) return;
    try { await HS_API.request(`/users/${userId}`, { method: "DELETE" }); hsToast("Usuario eliminado"); await renderUsers(); }
    catch (error) { hsToast(error.message); }
  }
  function organizationLabel(organization) {
    return organization.name === "HardSystem" ? "HardSystem (equipo interno)" : `${organization.name} (empresa cliente)`;
  }
  function organizationOptions(selectedId) {
    return state.organizations.map(organization => `<option value="${organization.id}" ${organization.id === selectedId ? "selected" : ""}>${escapeHtml(organizationLabel(organization))}</option>`).join("");
  }
  function openOrganizationEditDialog(organizationId) {
    const organization = state.organizations.find(item => item.id === organizationId); if (!organization) return;
    document.getElementById("editOrganizationId").value = organization.id;
    document.getElementById("editOrganizationName").value = organization.name;
    document.getElementById("editOrganizationTaxId").value = organization.tax_id || "";
    document.getElementById("editOrganizationEmail").value = organization.email || "";
    document.getElementById("editOrganizationPhone").value = organization.phone || "";
    document.getElementById("editOrganizationAddress").value = organization.address || "";
    document.getElementById("editOrganizationCity").value = organization.city || "";
    document.getElementById("editOrganizationStatus").value = String(organization.is_active);
    document.getElementById("editOrganizationError").classList.add("hidden");
    showDialog(document.getElementById("organizationEditDialog"));
  }
  async function toggleOrganizationStatus(organizationId) {
    const organization = state.organizations.find(item => item.id === organizationId); if (!organization) return;
    try { await HS_API.request(`/organizations/${organizationId}`, { method: "PATCH", body: JSON.stringify({ isActive: !organization.is_active }) }); hsToast(organization.is_active ? "Empresa desactivada" : "Empresa activada"); await loadView("organizations"); }
    catch (error) { hsToast(error.message); }
  }
  async function deleteOrganization(organizationId) {
    const organization = state.organizations.find(item => item.id === organizationId); if (!organization || !confirm(`¿Eliminar la empresa ${organization.name}? Esta acción no se puede deshacer.`)) return;
    try { await HS_API.request(`/organizations/${organizationId}`, { method: "DELETE" }); hsToast("Empresa eliminada"); await loadView("organizations"); }
    catch (error) { hsToast(error.message); }
  }
  function openUserEditDialog(userId) {
    const user = state.users.find(item => item.id === userId); if (!user) return;
    document.getElementById("editUserId").value = user.id; document.getElementById("editUserName").value = user.full_name; document.getElementById("editUserEmail").value = user.email; document.getElementById("editUserPhone").value = user.phone || ""; document.getElementById("editUserOrganization").innerHTML = organizationOptions(user.organization_id); document.getElementById("editUserRole").value = user.role; document.getElementById("editUserPassword").value = ""; document.getElementById("editUserError").classList.add("hidden"); showDialog(document.getElementById("userEditDialog"));
  }
  function updateStatusFields() {
    const status = document.getElementById("userAccountStatus").value; const restricted = status !== "active";
    document.getElementById("suspensionDateField").classList.toggle("hidden", status !== "suspended"); document.getElementById("userSuspendedUntil").required = status === "suspended"; document.getElementById("statusReasonField").classList.toggle("hidden", !restricted); document.getElementById("userStatusReason").required = restricted; document.getElementById("permanentStatusWarning").classList.toggle("hidden", status !== "disabled");
  }
  function openUserStatusDialog(userId) {
    const user = state.users.find(item => item.id === userId); if (!user) return;
    document.getElementById("userStatusForm").reset(); document.getElementById("statusUserId").value = user.id; document.getElementById("statusUserName").textContent = `${user.full_name} · ${user.email}`; document.getElementById("userAccountStatus").value = user.account_status === "active" ? "suspended" : "active"; document.getElementById("userSuspendedUntil").min = new Date(Date.now() + 60000).toISOString().slice(0, 16); document.getElementById("userStatusError").classList.add("hidden"); updateStatusFields(); showDialog(document.getElementById("userStatusDialog"));
  }
  async function renderCollection(view) {
    const { items } = await HS_API.request(`/${view}`); document.getElementById("portalStats").innerHTML = "";
    const configs = {
      assets: { headers: ["Código", "Equipo", "Propietario", "Serie", "Estado", "Ubicación", "Acciones"], row: item => [item.asset_tag, [item.brand, item.model].filter(Boolean).join(" ") || item.asset_type, item.owner_name || "Sin asignar", item.serial_number || "-", item.status, item.location || "-", collectionActions("assets", item.id)] },
      orders: { headers: ["Orden", "Estado", "Compra", "Pago", "Total", "Notas", "Acciones"], row: item => [`OC-${item.order_number}`, item.status, date(item.purchased_at), item.payment_provider === "paypal" ? `PayPal · ${item.payment_status === "completed" ? "Pagado" : item.payment_status}` : "Registro interno", hsMoney(item.total_cop), item.notes || "-", collectionActions("orders", item.id)] },
      contacts: { headers: ["Nombre", "Cargo", "Correo", "Teléfono", "Principal", "Acciones"], row: item => [item.full_name, item.position || "-", item.email || "-", item.phone || "-", item.is_primary ? "Sí" : "No", collectionActions("contacts", item.id)] },
      organizations: { headers: ["Empresa", "Correo", "Teléfono", "Ciudad", "Estado", "Acciones"], row: item => [item.name, item.email || "-", item.phone || "-", item.city, item.is_active ? "Activa" : "Inactiva", `<div class="user-actions"><button class="btn btn--ghost btn--sm" type="button" data-edit-organization="${item.id}">Editar</button><button class="btn btn--ghost btn--sm" type="button" data-toggle-organization="${item.id}">${item.is_active ? "Desactivar" : "Activar"}</button><button class="btn btn--ghost btn--sm" type="button" data-delete-organization="${item.id}">Eliminar</button></div>`] },
    }; const config = configs[view];
    state[view] = items;
    content.innerHTML = items.length ? `<div class="table-wrap"><table class="data-table"><thead><tr>${config.headers.map(header => `<th>${header}</th>`).join("")}</tr></thead><tbody>${items.map(item => `<tr>${config.row(item).map((value, index) => `<td>${index === config.headers.length - 1 ? value : escapeHtml(value)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : '<div class="empty-state"><h3>Sin registros</h3><p>Esta sección aún no tiene información registrada.</p></div>';
  }

  async function renderCommerce() {
    if (state.user.role !== "admin") throw new Error("Permisos de administrador requeridos");
    const data = await HS_API.request("/admin/commerce"); state.products = data.products; state.promotions = data.promotions;
    document.getElementById("viewKicker").textContent = "Gestión comercial"; document.getElementById("viewSubtitle").textContent = "Edita, previsualiza y publica el contenido visible en el sitio"; document.getElementById("portalStats").innerHTML = `<div><strong>${data.products.length}</strong><span>Productos</span></div><div><strong>${data.products.filter(item => item.is_active).length}</strong><span>Publicados</span></div><div><strong>${data.promotions.filter(item => item.is_active).length}</strong><span>Promociones activas</span></div>`;
    content.innerHTML = `<div class="commerce-tabs"><button class="is-active" type="button" data-commerce-tab="promotions">Promociones</button><button type="button" data-commerce-tab="products">Catálogo</button></div><section data-commerce-panel="promotions"><div class="commerce-promotion-grid">${data.promotions.map(promotionEditor).join("")}</div></section><section class="hidden" data-commerce-panel="products"><div class="commerce-toolbar"><div><h2>Productos del catálogo</h2><p>Gestiona precios, inventario y visibilidad.</p></div><button class="btn btn--primary" type="button" data-new-product>Agregar producto</button></div><div class="commerce-products">${data.products.map(productEditor).join("")}</div></section>`;
  }
  async function uploadCommerceImage(file) { const data=new FormData(); data.append("image",file); return (await HS_API.request("/admin/commerce/images",{method:"POST",body:data})).url; }
  function accentTitle(title, accent) { const safeTitle = escapeHtml(title); const safeAccent = escapeHtml(accent); return accent && title.toLowerCase().includes(accent.toLowerCase()) ? safeTitle.replace(new RegExp(escapeHtml(accent), "i"), `<span>${safeAccent}</span>`) : safeTitle; }
  function promotionEditor(item) { return `<article class="commerce-editor" data-promotion-editor="${item.slot}"><form data-promotion-form="${item.slot}"><div class="commerce-editor-head"><div><span>SLIDE ${item.slot + 1}</span><h2>Promoción ${item.slot}</h2></div><label class="switch-label"><input name="isActive" type="checkbox" ${item.is_active ? "checked" : ""}> Publicada</label></div><div class="field"><label>Etiqueta</label><input name="badge" value="${escapeHtml(item.badge)}" required maxlength="120"></div><div class="field"><label>Titular</label><input name="title" value="${escapeHtml(item.title)}" required maxlength="120"></div><div class="field"><label>Palabra destacada</label><input name="accent" value="${escapeHtml(item.accent)}" required maxlength="50"></div><div class="field"><label>Descripción</label><textarea name="description" required maxlength="500">${escapeHtml(item.description)}</textarea></div><div class="form-row"><div class="field"><label>Botón principal</label><input name="primaryLabel" value="${escapeHtml(item.primary_label)}" required></div><div class="field"><label>Enlace</label><input name="primaryUrl" value="${escapeHtml(item.primary_url)}" required></div></div><div class="form-row"><div class="field"><label>Botón secundario</label><input name="secondaryLabel" value="${escapeHtml(item.secondary_label)}" required></div><div class="field"><label>Enlace</label><input name="secondaryUrl" value="${escapeHtml(item.secondary_url)}" required></div></div><div class="form-row"><div class="field"><label>Etiqueta inferior</label><input name="noteLabel" value="${escapeHtml(item.note_label)}" required></div><div class="field"><label>Detalle inferior</label><input name="noteText" value="${escapeHtml(item.note_text)}" required></div></div><div class="field"><label>Imagen de la promoción</label><input name="imageFile" type="file" accept="image/png,image/jpeg,image/webp"><input name="imageUrl" type="hidden" value="${escapeHtml(item.image_url)}"><span class="field-help">PNG, JPEG o WebP. Se optimiza automáticamente.</span></div><input name="imageAlt" type="hidden" value="${escapeHtml(item.image_alt)}"><button class="btn btn--primary btn--block" type="submit">Publicar promoción</button></form><div class="commerce-preview"><span class="preview-label">Vista previa en tiempo real</span><div class="commerce-slide-preview"><div><small data-preview="badge">${escapeHtml(item.badge)}</small><h3 data-preview="title">${accentTitle(item.title,item.accent)}</h3><p data-preview="description">${escapeHtml(item.description)}</p><div><b data-preview="primaryLabel">${escapeHtml(item.primary_label)}</b><i data-preview="secondaryLabel">${escapeHtml(item.secondary_label)}</i></div><em><strong data-preview="noteLabel">${escapeHtml(item.note_label)}</strong> <span data-preview="noteText">${escapeHtml(item.note_text)}</span></em></div><img data-preview="imageUrl" src="${escapeHtml(item.image_url)}" alt=""></div></div></article>`; }
  function productEditor(item = {}) { return `<article class="commerce-product" data-product-id="${item.id || ""}"><div class="commerce-product-preview">${item.image_url ? `<img src="${escapeHtml(item.image_url)}" alt="">` : "<span>Sin imagen</span>"}</div><form data-product-form><div class="form-row"><div class="field"><label>SKU</label><input name="sku" value="${escapeHtml(item.sku || "")}" required></div><div class="field"><label>Producto</label><input name="name" value="${escapeHtml(item.name || "")}" required></div></div><div class="field"><label>Descripción</label><textarea name="description">${escapeHtml(item.description || "")}</textarea></div><div class="form-row"><div class="field"><label>Categoría</label><input name="category" value="${escapeHtml(item.category || "")}" required></div><div class="field"><label>Imagen del producto</label><input name="imageFile" type="file" accept="image/png,image/jpeg,image/webp"><input name="imageUrl" type="hidden" value="${escapeHtml(item.image_url || "")}"></div></div><div class="commerce-product-numbers"><div class="field"><label>Precio COP</label><input name="priceCop" type="number" min="0" value="${item.price_cop || 0}" required></div><div class="field"><label>Stock</label><input name="stock" type="number" min="0" value="${item.stock || 0}" required></div><div class="field"><label>Stock mínimo</label><input name="minimumStock" type="number" min="0" value="${item.minimum_stock || 0}" required></div></div><div class="commerce-checks"><label><input name="isActive" type="checkbox" ${item.is_active !== false ? "checked" : ""}> Publicado</label><label><input name="isFeatured" type="checkbox" ${item.is_featured ? "checked" : ""}> Destacado</label></div><div class="commerce-product-actions"><button class="btn btn--primary" type="submit">Guardar</button>${item.id ? `<button class="btn btn--ghost" type="button" data-delete-product="${item.id}">Eliminar</button>` : ""}</div></form></article>`; }
  function collectionActions(view, id) { return `<div class="user-actions"><button class="btn btn--ghost btn--sm" type="button" data-edit-record="${view}:${id}">Editar</button><button class="btn btn--ghost btn--sm" type="button" data-delete-record="${view}:${id}">Eliminar</button></div>`; }
  function assetOwnerOptions(organizationId, selectedId = "") {
    const owners = state.ticketClients.filter(client => client.organization_id === organizationId);
    return '<option value="">Seleccione un propietario</option>' + owners.map(owner => `<option value="${owner.id}" ${owner.id === selectedId ? "selected" : ""}>${escapeHtml(owner.full_name)} · ${escapeHtml(owner.email)}</option>`).join("");
  }
  function syncAssetOwnerField(selectedId = "") {
    const organization = document.getElementById("recordOrganization"); const owner = document.getElementById("recordOwnerUser"); if (!organization || !owner) return;
    const hasOwners = state.ticketClients.some(client => client.organization_id === organization.value); owner.innerHTML = assetOwnerOptions(organization.value, selectedId); owner.disabled = !hasOwners;
  }

  async function openRecordDialog(record = null) {
    const definitions = {
      assets: { title: "Registrar equipo", fields: [["assetTag", "Código de activo"], ["assetType", "Tipo de equipo"], ["brand", "Marca"], ["model", "Modelo"], ["serialNumber", "Número de serie"], ["status", "Estado", "select", [["active", "Activo"], ["in_service", "En servicio"], ["inactive", "Inactivo"], ["retired", "Retirado"], ["lost", "Extraviado"]]], ["location", "Ubicación"]] },
      contacts: { title: "Registrar contacto", fields: [["fullName", "Nombre completo"], ["email", "Correo", "email"], ["phone", "Teléfono"], ["position", "Cargo"], ["isPrimary", "Contacto principal", "select", [["false", "No"], ["true", "Sí"]]], ["isActive", "Estado", "select", [["true", "Activo"], ["false", "Inactivo"]]]] },
      orders: { title: "Registrar compra", fields: [["status", "Estado", "select", [["draft", "Borrador"], ["confirmed", "Confirmada"], ["processing", "En proceso"], ["delivered", "Entregada"], ["cancelled", "Cancelada"]]], ["totalCop", "Total en COP", "number"], ["notes", "Descripción de la compra"]] },
      organizations: { title: "Registrar empresa", fields: [["name", "Razón social"], ["taxId", "NIT"], ["email", "Correo", "email"], ["phone", "Teléfono"], ["address", "Dirección"], ["city", "Ciudad"]] },
      users: { title: "Crear usuario", fields: [["fullName", "Nombre completo"], ["email", "Correo", "email"], ["phone", "Teléfono"], ["password", "Contraseña temporal", "password"]] },
    };
    const definition = definitions[state.view]; if (!definition) return;
    let organizationField = ""; let ownerField = "";
    if (state.view !== "organizations") {
      const organizations = (await HS_API.request("/organizations")).items;
      organizationField = `<div class="field"><label for="recordOrganization">Empresa</label><select name="organizationId" id="recordOrganization" required>${organizations.map(item => `<option value="${item.id}">${escapeHtml(organizationLabel(item))}</option>`).join("")}</select></div>`;
    }
    if (state.view === "assets") {
      state.ticketClients = (await HS_API.request("/ticket-clients")).items;
      ownerField = '<div class="field"><label for="recordOwnerUser">Usuario propietario</label><select name="ownerUserId" id="recordOwnerUser" required><option value="">Seleccione un propietario</option></select><span class="field-help">Clientes activos de la empresa seleccionada.</span></div>';
    }
    const roleField = state.view === "users" ? '<div class="field"><label for="recordRole">Rol</label><select name="role" id="recordRole"><option value="client">Cliente</option><option value="agent">Agente</option><option value="supervisor">Supervisor</option><option value="admin">Administrador</option></select></div>' : "";
    document.getElementById("recordTitle").textContent = record ? `Editar ${state.view === "assets" ? "equipo" : state.view === "contacts" ? "contacto" : "compra"}` : definition.title;
    document.getElementById("recordFields").innerHTML = organizationField + ownerField + definition.fields.map(([name, label, type = "text", options = []]) => `<div class="field"><label for="record-${name}">${label}</label>${type === "select" ? `<select id="record-${name}" name="${name}" required>${options.map(([value, text]) => `<option value="${value}">${text}</option>`).join("")}</select>` : `<input id="record-${name}" name="${name}" type="${type}" ${name === "password" ? 'minlength="12"' : ""} ${["brand", "model", "serialNumber", "location", "phone", "position", "taxId", "address", "notes"].includes(name) ? "" : "required"}>`}</div>`).join("") + roleField;
    document.getElementById("recordId").value = record?.id || "";
    if (record) definition.fields.forEach(([name]) => { const field = document.getElementById(`record-${name}`); const sourceName = { assetTag: "asset_tag", assetType: "asset_type", serialNumber: "serial_number", isPrimary: "is_primary", isActive: "is_active", totalCop: "total_cop" }[name] || name; if (field) field.value = String(record[name] ?? record[sourceName] ?? ""); });
    if (record && document.getElementById("recordOrganization")) document.getElementById("recordOrganization").value = record.organization_id;
    if (state.view === "assets") syncAssetOwnerField(record?.owner_user_id || "");
    document.getElementById("recordError").classList.add("hidden"); showDialog(document.getElementById("recordDialog"));
  }

  document.getElementById("loginForm").addEventListener("submit", async event => { event.preventDefault(); const error = document.getElementById("loginError"); error.classList.add("hidden"); try { const result = await HS_API.request("/auth/login", { method: "POST", body: JSON.stringify({ email: document.getElementById("loginEmail").value.trim(), password: document.getElementById("loginPassword").value }) }); HS_API.setToken(result.token); await HS_CART.mergeOnLogin(); if (returnToCheckout()) return; state.user = result.user; showApp(); await loadView(initialView()); } catch (requestError) { error.textContent = requestError.message; error.classList.remove("hidden"); } });
  document.getElementById("revealPassword").addEventListener("click", event => { const password = document.getElementById("loginPassword"); const visible = password.type === "text"; password.type = visible ? "password" : "text"; event.currentTarget.setAttribute("aria-label", visible ? "Mostrar contraseña" : "Ocultar contraseña"); });
  document.getElementById("logoutBtn").addEventListener("click", () => { HS_API.setToken(null); HS_CART.resetSession(); state.user = null; showLogin(); });
  document.getElementById("portalNav").addEventListener("click", event => { const button = event.target.closest("[data-view]"); if (button) void loadView(button.dataset.view); });
  document.getElementById("dashboardPeriod").addEventListener("change", event => { state.dashboardPeriod = event.target.value; document.getElementById("customPeriod").classList.toggle("hidden", state.dashboardPeriod !== "custom"); void renderDashboard(); });
  document.getElementById("customPeriod").addEventListener("change", event => { if (event.target.id === "dashboardStart") state.customStart = event.target.value; if (event.target.id === "dashboardEnd") state.customEnd = event.target.value; if (state.customStart && state.customEnd) void renderDashboard(); });
  content.addEventListener("click", event => { const link = event.target.closest("[data-view-link]"); if (link) return void loadView(link.dataset.viewLink); const reportType = event.target.closest("[data-report-type]"); if (reportType) { state.reportType = reportType.dataset.reportType; return void renderReports(); } const reportMenu = event.target.closest("[data-report-menu]"); if (reportMenu) { state.reportType = ""; return void renderReports(); } const statisticsButton = event.target.closest("[data-statistics-pdf]"); if (statisticsButton) return void downloadStatisticsReport(statisticsButton); const recordReportButton = event.target.closest("[data-report-record-id]"); if (recordReportButton) return void downloadRecordReport(recordReportButton); const reportButton = event.target.closest("[data-report-id]"); if (reportButton) return void downloadReport(reportButton); });
  content.addEventListener("change", event => { if (event.target.id === "reportStatusFilter") { state.reportStatus = event.target.value; void renderReports(); } if (["statisticsTicketStatus", "statisticsAssetStatus", "statisticsPeriod"].includes(event.target.id)) { state.statisticsFilters[{ statisticsTicketStatus: "ticketStatus", statisticsAssetStatus: "assetStatus", statisticsPeriod: "period" }[event.target.id]] = event.target.value; void renderStatistics(); } });
  content.addEventListener("change", event => { const field = event.target.closest("#ticketStatus, #ticketTechnician, #ticketCategory, #ticketSort"); if (!field) return; state.ticketFilters[{ ticketStatus: "status", ticketTechnician: "technician", ticketCategory: "category", ticketSort: "sort" }[field.id]] = field.value; void renderTickets(false); });
  content.addEventListener("input", event => { if (event.target.id !== "ticketSearch") return; state.ticketFilters.search = event.target.value; void renderTickets(false); });
  content.addEventListener("input", event => {
    const editor = event.target.closest("[data-promotion-editor]"); if (!editor) return; const field = event.target.name; const preview = editor.querySelector(`[data-preview="${field}"]`); if (preview && field !== "imageUrl") preview.textContent = event.target.value; if (field === "imageUrl") editor.querySelector('[data-preview="imageUrl"]').src = event.target.value; if (field === "imageFile" && event.target.files[0]) editor.querySelector('[data-preview="imageUrl"]').src = URL.createObjectURL(event.target.files[0]); if (["title","accent"].includes(field)) { const form = editor.querySelector("form"); editor.querySelector('[data-preview="title"]').innerHTML = accentTitle(form.elements.title.value,form.elements.accent.value); }
  });
  content.addEventListener("click", event => {
    const tab = event.target.closest("[data-commerce-tab]"); if (tab) { content.querySelectorAll("[data-commerce-tab]").forEach(button => button.classList.toggle("is-active",button===tab)); content.querySelectorAll("[data-commerce-panel]").forEach(panel => panel.classList.toggle("hidden",panel.dataset.commercePanel!==tab.dataset.commerceTab)); return; }
    if (event.target.closest("[data-new-product]")) { content.querySelector(".commerce-products").insertAdjacentHTML("afterbegin",productEditor()); event.target.closest("[data-new-product]").disabled=true; return; }
    const remove = event.target.closest("[data-delete-product]"); if (remove && window.confirm("¿Eliminar este producto del catálogo?")) void HS_API.request(`/admin/products/${remove.dataset.deleteProduct}`,{method:"DELETE"}).then(() => { hsToast("Producto eliminado"); return renderCommerce(); }).catch(error => hsToast(error.message));
  });
  content.addEventListener("submit", async event => {
    const promotionForm = event.target.closest("[data-promotion-form]"); const productForm = event.target.closest("[data-product-form]"); if (!promotionForm && !productForm) return; event.preventDefault();
    try {
      if (promotionForm) { const values=Object.fromEntries(new FormData(promotionForm)); const file=promotionForm.elements.imageFile.files[0]; if(file) values.imageUrl=await uploadCommerceImage(file); delete values.imageFile; values.isActive=promotionForm.elements.isActive.checked; await HS_API.request(`/admin/promotions/${promotionForm.dataset.promotionForm}`,{method:"PATCH",body:JSON.stringify(values)}); hsToast("Promoción publicada"); await renderCommerce(); }
      if (productForm) { const card=productForm.closest("[data-product-id]"); const values=Object.fromEntries(new FormData(productForm)); const file=productForm.elements.imageFile.files[0]; if(file) values.imageUrl=await uploadCommerceImage(file); delete values.imageFile; Object.assign(values,{priceCop:Number(values.priceCop),stock:Number(values.stock),minimumStock:Number(values.minimumStock),isActive:productForm.elements.isActive.checked,isFeatured:productForm.elements.isFeatured.checked,imageUrl:values.imageUrl||null,icon:"box",specifications:{}}); await HS_API.request(`/admin/products${card.dataset.productId?`/${card.dataset.productId}`:""}`,{method:card.dataset.productId?"PATCH":"POST",body:JSON.stringify(values)}); hsToast("Producto guardado"); await renderCommerce(); }
    } catch (error) { hsToast(error.message); }
  });
  document.getElementById("newTicketBtn").addEventListener("click", openTicketDialog);
  document.getElementById("ticketClientSearch").addEventListener("input", event => { populateTicketClientOptions(event.target.value); refreshTicketAssets(document.getElementById("ticketClient").value || null); });
  document.getElementById("ticketClient").addEventListener("change", event => { refreshTicketAssets(event.target.value || null); });
  document.getElementById("recordFields").addEventListener("change", event => { if (event.target.id === "recordOrganization" && state.view === "assets") syncAssetOwnerField(); });
  document.getElementById("manageRecordBtn").addEventListener("click", () => void openRecordDialog());
  document.querySelectorAll("[data-close-dialog]").forEach(button => button.addEventListener("click", () => closeDialogSafely(document.getElementById(button.dataset.closeDialog))));
  document.getElementById("ticketForm").addEventListener("submit", async event => { event.preventDefault(); const zone = document.getElementById("ticketError"); zone.classList.add("hidden"); try { const isStaff = state.user.role !== "client"; const clientId = document.getElementById("ticketClient").value; const ticket = await HS_API.request("/tickets", { method: "POST", body: JSON.stringify({ ...(isStaff ? { clientId } : {}), subject: document.getElementById("ticketSubject").value.trim(), description: document.getElementById("ticketDescription").value.trim(), priority: document.getElementById("ticketPriority").value, assetId: document.getElementById("ticketAsset").value || null }) }); event.target.reset(); document.getElementById("ticketDialog").close(); showTicketCreated(ticket); await renderTickets(); } catch (error) { zone.textContent = error.message; zone.classList.remove("hidden"); } });
  content.addEventListener("click", event => { const editUser = event.target.closest("[data-edit-user]"); const statusUser = event.target.closest("[data-status-user]"); const deleteUserButton = event.target.closest("[data-delete-user]"); const editOrganization = event.target.closest("[data-edit-organization]"); const toggleOrganization = event.target.closest("[data-toggle-organization]"); const deleteOrganizationButton = event.target.closest("[data-delete-organization]"); const editRecord = event.target.closest("[data-edit-record]"); const deleteRecordButton = event.target.closest("[data-delete-record]"); if (editUser) return openUserEditDialog(editUser.dataset.editUser); if (statusUser) return openUserStatusDialog(statusUser.dataset.statusUser); if (deleteUserButton) return void deleteUser(deleteUserButton.dataset.deleteUser); if (editOrganization) return openOrganizationEditDialog(editOrganization.dataset.editOrganization); if (toggleOrganization) return void toggleOrganizationStatus(toggleOrganization.dataset.toggleOrganization); if (deleteOrganizationButton) return void deleteOrganization(deleteOrganizationButton.dataset.deleteOrganization); if (editRecord) { const [view, id] = editRecord.dataset.editRecord.split(":"); state.view = view; return void openRecordDialog(state[view].find(item => item.id === id)); } if (deleteRecordButton) return void deleteCollectionRecord(deleteRecordButton.dataset.deleteRecord); const row = event.target.closest("[data-ticket-id]"); if (row && !event.target.closest("select")) void openTicket(row.dataset.ticketId); });
  content.addEventListener("change", async event => { const status = event.target.closest("[data-status]"); const assignee = event.target.closest("[data-assignee]"); if (!status && !assignee) return; const id = (status || assignee).dataset.status || (status || assignee).dataset.assignee; const ticket = state.tickets.find(item => item.id === id); if (status?.value === "closed") { status.value = ticket.status; openClosureDialog(id); return; } if (status && ticket.status === "closed") { status.value = ticket.status; openReopenDialog(id); return; } await HS_API.request(`/tickets/${id}`, { method: "PATCH", body: JSON.stringify(status ? { status: status.value } : { assignedTo: assignee.value || null }) }); hsToast("Ticket actualizado"); await renderTickets(); });
  content.addEventListener("submit", async event => { const form = event.target.closest("[data-comment-form]"); if (!form) return; event.preventDefault(); try { const ticketId = form.dataset.commentForm; const files = [...form.querySelector("[data-comment-images]").files]; if (files.length > 4) throw new Error("Puede adjuntar máximo 4 imágenes por comentario"); const comment = await HS_API.request(`/tickets/${ticketId}/comments`, { method: "POST", body: JSON.stringify({ body: form.querySelector("textarea").value, internal: form.querySelector('input[type="checkbox"]')?.checked || false }) }); await uploadImages(ticketId, comment.id, files); await showTicket(ticketId); hsToast("Comentario publicado"); } catch (error) { hsToast(error.message); } });
  document.getElementById("closureForm").addEventListener("submit", async event => {
    event.preventDefault(); const errorZone = document.getElementById("closureError"); errorZone.classList.add("hidden");
    try { const ticketId = document.getElementById("closureTicketId").value; const result = await HS_API.request(`/tickets/${ticketId}`, { method: "PATCH", body: JSON.stringify({ status: "closed", closureCause: document.getElementById("closureCause").value, closureNote: document.getElementById("closureNote").value }) }); const image = document.getElementById("closureImage").files[0]; if (image) await uploadImages(ticketId, result.closureCommentId, [image]); document.getElementById("closureDialog").close(); hsToast("Incidencia cerrada con soporte"); await renderTickets(); }
    catch (error) { errorZone.textContent = error.message; errorZone.classList.remove("hidden"); }
  });
  document.getElementById("reopenForm").addEventListener("submit", async event => {
    event.preventDefault(); const errorZone = document.getElementById("reopenError"); errorZone.classList.add("hidden");
    try { const ticketId = document.getElementById("reopenTicketId").value; await HS_API.request(`/tickets/${ticketId}`, { method: "PATCH", body: JSON.stringify({ status: "open", reopenCause: document.getElementById("reopenCause").value, reopenNote: document.getElementById("reopenNote").value }) }); document.getElementById("reopenDialog").close(); hsToast("Incidencia reabierta con soporte"); await renderTickets(); }
    catch (error) { errorZone.textContent = error.message; errorZone.classList.remove("hidden"); }
  });
  document.getElementById("userAccountStatus").addEventListener("change", updateStatusFields);
  document.getElementById("userEditForm").addEventListener("submit", async event => {
    event.preventDefault(); const errorZone = document.getElementById("editUserError"); errorZone.classList.add("hidden"); const password = document.getElementById("editUserPassword").value;
    try { await HS_API.request(`/users/${document.getElementById("editUserId").value}`, { method: "PATCH", body: JSON.stringify({ organizationId: document.getElementById("editUserOrganization").value, fullName: document.getElementById("editUserName").value, email: document.getElementById("editUserEmail").value, phone: document.getElementById("editUserPhone").value || null, role: document.getElementById("editUserRole").value, ...(password ? { password } : {}) }) }); document.getElementById("userEditDialog").close(); hsToast("Usuario actualizado"); await renderUsers(); }
    catch (error) { errorZone.textContent = error.message; errorZone.classList.remove("hidden"); }
  });
  document.getElementById("userStatusForm").addEventListener("submit", async event => {
    event.preventDefault(); const errorZone = document.getElementById("userStatusError"); errorZone.classList.add("hidden"); const status = document.getElementById("userAccountStatus").value;
    try { await HS_API.request(`/users/${document.getElementById("statusUserId").value}/status`, { method: "PATCH", body: JSON.stringify({ status, ...(status === "suspended" ? { suspendedUntil: new Date(document.getElementById("userSuspendedUntil").value).toISOString() } : {}), ...(status !== "active" ? { reason: document.getElementById("userStatusReason").value } : {}) }) }); document.getElementById("userStatusDialog").close(); hsToast(status === "active" ? "Cuenta reactivada" : status === "suspended" ? "Cuenta suspendida" : "Cuenta inhabilitada"); await renderUsers(); }
    catch (error) { errorZone.textContent = error.message; errorZone.classList.remove("hidden"); }
  });
  document.getElementById("organizationEditForm").addEventListener("submit", async event => {
    event.preventDefault(); const errorZone = document.getElementById("editOrganizationError"); errorZone.classList.add("hidden");
    try { await HS_API.request(`/organizations/${document.getElementById("editOrganizationId").value}`, { method: "PATCH", body: JSON.stringify({ name: document.getElementById("editOrganizationName").value.trim(), taxId: document.getElementById("editOrganizationTaxId").value.trim() || null, email: document.getElementById("editOrganizationEmail").value.trim() || null, phone: document.getElementById("editOrganizationPhone").value.trim() || null, address: document.getElementById("editOrganizationAddress").value.trim() || null, city: document.getElementById("editOrganizationCity").value.trim(), isActive: document.getElementById("editOrganizationStatus").value === "true" }) }); document.getElementById("organizationEditDialog").close(); hsToast("Empresa actualizada"); await loadView("organizations"); }
    catch (error) { errorZone.textContent = error.message; errorZone.classList.remove("hidden"); }
  });
  document.getElementById("recordForm").addEventListener("submit", async event => {
    event.preventDefault(); const data = Object.fromEntries(new FormData(event.target));
    for (const [key, value] of Object.entries(data)) if (value === "") data[key] = null;
    const recordId = document.getElementById("recordId").value;
    if (state.view === "orders") { data.totalCop = Number(data.totalCop); if (!recordId) data.status = "confirmed"; }
    if (state.view === "contacts") { data.isPrimary = data.isPrimary === "true"; data.isActive = data.isActive === "true"; }
    try { await HS_API.request(`/${state.view}${recordId ? `/${recordId}` : ""}`, { method: recordId ? "PATCH" : "POST", body: JSON.stringify(data) }); document.getElementById("recordDialog").close(); event.target.reset(); hsToast(recordId ? "Registro actualizado" : "Registro guardado"); await loadView(state.view); }
    catch (error) { const zone = document.getElementById("recordError"); const detail = error.details?.[0]; zone.textContent = detail ? `${detail.path?.join(".") || "Campo"}: ${detail.message}` : error.message; zone.classList.remove("hidden"); }
  });
  async function deleteCollectionRecord(key) { const [view, id] = key.split(":"); if (!confirm("¿Eliminar este registro? Esta acción no se puede deshacer.")) return; try { await HS_API.request(`/${view}/${id}`, { method: "DELETE" }); hsToast("Registro eliminado"); await loadView(view); } catch (error) { hsToast(error.message); } }
  document.querySelectorAll("dialog").forEach(dialog => dialog.addEventListener("cancel", event => {
    if (!hasDialogChanges(dialog)) return;
    event.preventDefault();
    closeDialogSafely(dialog);
  }));
  void loadSession();
});