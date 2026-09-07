/* ============================================================
   Systemach — Carrito de compras (frontend, localStorage)
   API: HS_CART.get / add / setQty / remove / clear / count / total
   Preparado para conectarse a backend + pasarela de pago.
   ============================================================ */

const HS_CART = (() => {
  const KEY = "hs_cart_v1";
  const PENDING_PREFIX = "hs_cart_pending_v1:";
  let remoteItems = null;
  let revision = 0;
  let persistence = Promise.resolve();

  function readLocal(key = KEY) {
    try { return JSON.parse(localStorage.getItem(key)) || []; }
    catch { return []; }
  }
  function writeLocal(items, key = KEY) {
    localStorage.setItem(key, JSON.stringify(items));
  }
  function accountId() {
    return typeof HS_API === "undefined" ? null : HS_API.getSessionUser()?.sub || null;
  }
  function pendingKey() {
    const id = accountId();
    return id ? PENDING_PREFIX + id : null;
  }
  function rawItems() {
    return remoteItems === null ? readLocal() : remoteItems;
  }
  function applyRemote(result) {
    remoteItems = result.items.map(item => ({ id: item.id, qty: item.qty }));
    updateBadge();
    document.dispatchEvent(new CustomEvent("hs:cart-updated"));
  }
  function persist(items) {
    const key = pendingKey();
    if (!key) return;
    const currentRevision = ++revision;
    writeLocal(items, key);
    persistence = persistence.then(async () => {
      const result = await HS_API.request("/cart", { method: "PUT", body: JSON.stringify({ items }) });
      if (currentRevision === revision) {
        localStorage.removeItem(key);
        applyRemote(result);
      }
    }).catch(error => console.error("No fue posible sincronizar el carrito", error));
  }
  function write(items) {
    if (remoteItems !== null && accountId()) {
      remoteItems = items;
      updateBadge();
      persist(items);
      return;
    }
    writeLocal(items);
    updateBadge();
  }
  function get() {
    // Une el carrito con la data de productos
    return rawItems()
      .map(({ id, qty }) => {
        const p = HS_DATA.products.find(x => x.id === id);
        return p ? { ...p, qty } : null;
      })
      .filter(Boolean);
  }
  function add(id, qty = 1) {
    const p = HS_DATA.products.find(x => x.id === id);
    if (!p || p.stock <= 0) return;
    const items = rawItems().map(item => ({ ...item }));
    const line = items.find(i => i.id === id);
    if (line) line.qty = Math.min(line.qty + qty, p.stock);
    else items.push({ id, qty: Math.min(qty, p.stock) });
    write(items);
    hsToast(`${p.name} agregado al carrito`);
  }
  function setQty(id, qty) {
    const p = HS_DATA.products.find(x => x.id === id);
    let items = rawItems().map(item => ({ ...item }));
    if (qty <= 0) items = items.filter(i => i.id !== id);
    else {
      const line = items.find(i => i.id === id);
      if (line) line.qty = Math.min(qty, p ? p.stock : qty);
    }
    write(items);
  }
  function remove(id) { write(rawItems().filter(i => i.id !== id)); }
  function clear() { write([]); }
  function count() { return rawItems().reduce((s, i) => s + i.qty, 0); }
  function subtotal() { return get().reduce((s, i) => s + i.price * i.qty, 0); }

  async function init() {
    if (!accountId()) { remoteItems = null; updateBadge(); return; }
    const key = pendingKey();
    try {
      let result = key && readLocal(key).length
        ? await HS_API.request("/cart", { method: "PUT", body: JSON.stringify({ items: readLocal(key) }) })
        : await HS_API.request("/cart");
      if (key) localStorage.removeItem(key);
      const anonymousItems = readLocal();
      if (anonymousItems.length) {
        result = await HS_API.request("/cart/merge", { method: "POST", body: JSON.stringify({ items: anonymousItems }) });
        localStorage.removeItem(KEY);
      }
      applyRemote(result);
    } catch (error) {
      console.error("No fue posible cargar el carrito de la cuenta", error);
      remoteItems = null;
      updateBadge();
    }
  }
  async function mergeOnLogin() { await init(); }
  function resetSession() { remoteItems = null; revision += 1; updateBadge(); }

  function updateBadge() {
    const badge = document.getElementById("cartBadge");
    if (!badge) return;
    const n = count();
    badge.textContent = n;
    badge.classList.toggle("is-empty", n === 0);
  }

  document.addEventListener("DOMContentLoaded", updateBadge);

  return { get, add, setQty, remove, clear, count, subtotal, init, mergeOnLogin, resetSession, updateBadge };
})();
