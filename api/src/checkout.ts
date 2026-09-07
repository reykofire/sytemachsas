import { config } from "./config.js";
import { shippingCop } from "./currency.js";
import { pool } from "./database.js";
import { capturePayPalOrder, createPayPalOrder, paypalEnabled, usdFromCop } from "./paypal.js";

const SHIPPING_COP = 25_000;
type CheckoutUser = { sub: string; organizationId: string | null };
type SnapshotItem = { id: string; sku: string; name: string; qty: number; unitPriceCop: number };
type PricedItem = SnapshotItem & { specifications: unknown };

function checkoutError(message: string, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function parseSnapshot(value: unknown): SnapshotItem[] {
  if (!Array.isArray(value)) throw checkoutError("El intento de pago no contiene un carrito válido", 500);
  return value.map(item => {
    const row = item as Partial<SnapshotItem>;
    if (!row.id || !row.name || !Number.isInteger(row.qty) || !Number.isInteger(row.unitPriceCop)) throw checkoutError("El intento de pago contiene datos inválidos", 500);
    return row as SnapshotItem;
  });
}

async function validateStock(items: SnapshotItem[]) {
  const result = await pool.query("SELECT id,stock,is_active FROM products WHERE id=ANY($1::uuid[])", [items.map(item => item.id)]);
  const products = new Map(result.rows.map(product => [product.id as string, product]));
  for (const item of items) {
    const product = products.get(item.id);
    if (!product?.is_active || Number(product.stock) < item.qty) throw checkoutError(`No hay existencias suficientes de ${item.name}`, 409);
  }
}

export function paypalCheckoutConfig() {
  return {
    enabled: paypalEnabled,
    clientId: paypalEnabled ? config.PAYPAL_CLIENT_ID : null,
    mode: config.PAYPAL_MODE,
    currency: "USD",
    copPerUsd: config.PAYPAL_COP_PER_USD,
  };
}

export async function createCheckout(user: CheckoutUser) {
  if (!paypalEnabled) throw checkoutError("PayPal aún no está configurado", 503);
  if (!user.organizationId) throw checkoutError("La cuenta debe pertenecer a una empresa para comprar", 409);
  const result = await pool.query(`SELECT ci.product_id id,p.sku,p.name,ci.quantity qty,p.price_cop,p.stock,p.is_active,p.specifications
    FROM shopping_carts sc JOIN shopping_cart_items ci ON ci.cart_id=sc.id JOIN products p ON p.id=ci.product_id
    WHERE sc.user_id=$1 ORDER BY ci.added_at`, [user.sub]);
  if (!result.rowCount) throw checkoutError("El carrito está vacío");
  const pricedItems: PricedItem[] = result.rows.map(item => ({ id: item.id, sku: item.sku, name: item.name, qty: Number(item.qty), unitPriceCop: Number(item.price_cop), specifications: item.specifications }));
  const items: SnapshotItem[] = pricedItems.map(({ specifications: _specifications, ...item }) => item);
  await validateStock(items);
  const subtotalCop = items.reduce((sum, item) => sum + item.unitPriceCop * item.qty, 0);
  const checkoutShippingCop = shippingCop(pricedItems, SHIPPING_COP);
  const totalCop = subtotalCop + checkoutShippingCop;
  const amountUsd = usdFromCop(totalCop, config.PAYPAL_COP_PER_USD);
  const attempt = (await pool.query(`INSERT INTO payment_attempts(user_id,organization_id,provider,subtotal_cop,shipping_cop,total_cop,payment_currency,payment_amount,exchange_rate,cart_snapshot)
    VALUES($1,$2,'paypal',$3,$4,$5,'USD',$6,$7,$8) RETURNING id`, [user.sub,user.organizationId,subtotalCop,checkoutShippingCop,totalCop,amountUsd,config.PAYPAL_COP_PER_USD,JSON.stringify(items)])).rows[0];
  try {
    const providerOrderId = await createPayPalOrder(attempt.id, amountUsd, totalCop);
    await pool.query("UPDATE payment_attempts SET provider_order_id=$2,status='created',updated_at=now() WHERE id=$1", [attempt.id, providerOrderId]);
    return { paypalOrderId: providerOrderId, amountUsd, totalCop, currency: "USD", copPerUsd: config.PAYPAL_COP_PER_USD };
  } catch (error) {
    await pool.query("UPDATE payment_attempts SET status='failed',failure_reason=$2,updated_at=now() WHERE id=$1", [attempt.id, error instanceof Error ? error.message.slice(0, 1000) : "Error de PayPal"]);
    throw error;
  }
}

export async function captureCheckout(user: CheckoutUser, providerOrderId: string) {
  const attempt = (await pool.query("SELECT * FROM payment_attempts WHERE provider_order_id=$1 AND user_id=$2", [providerOrderId, user.sub])).rows[0];
  if (!attempt) throw checkoutError("Intento de pago no encontrado", 404);
  if (attempt.order_id) {
    const order = (await pool.query("SELECT id,order_number,status,total_cop FROM orders WHERE id=$1", [attempt.order_id])).rows[0];
    return { order, alreadyCaptured: true };
  }
  const items = parseSnapshot(attempt.cart_snapshot);
  await validateStock(items);
  const capture = await capturePayPalOrder(providerOrderId, attempt.id);
  if (capture.currency !== "USD" || capture.amount !== Number(attempt.payment_amount).toFixed(2)) {
    await pool.query("UPDATE payment_attempts SET status='captured_review',provider_capture_id=$2,failure_reason='Importe o moneda de captura no coincide',updated_at=now() WHERE id=$1", [attempt.id, capture.captureId]);
    throw checkoutError("El pago fue recibido, pero requiere validación manual", 409);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const lockedAttempt = (await client.query("SELECT order_id FROM payment_attempts WHERE id=$1 FOR UPDATE", [attempt.id])).rows[0];
    if (lockedAttempt.order_id) {
      const order = (await client.query("SELECT id,order_number,status,total_cop FROM orders WHERE id=$1", [lockedAttempt.order_id])).rows[0];
      await client.query("COMMIT");
      return { order, alreadyCaptured: true };
    }
    const productsResult = await client.query("SELECT id,stock,is_active FROM products WHERE id=ANY($1::uuid[]) FOR UPDATE", [items.map(item => item.id)]);
    const products = new Map(productsResult.rows.map(product => [product.id as string, product]));
    for (const item of items) {
      const product = products.get(item.id);
      if (!product?.is_active || Number(product.stock) < item.qty) throw checkoutError(`Pago recibido; ${item.name} requiere revisión de inventario`, 409);
    }
    const order = (await client.query(`INSERT INTO orders(organization_id,status,purchased_at,subtotal_cop,shipping_cop,total_cop,notes,created_by,payment_provider,payment_status,payment_reference,payment_currency,payment_amount,exchange_rate)
      VALUES($1,'confirmed',now(),$2,$3,$4,'Compra en línea mediante PayPal',$5,'paypal','completed',$6,'USD',$7,$8) RETURNING id,order_number,status,total_cop`,
      [attempt.organization_id,attempt.subtotal_cop,attempt.shipping_cop,attempt.total_cop,user.sub,capture.captureId,attempt.payment_amount,attempt.exchange_rate])).rows[0];
    for (const item of items) {
      await client.query("INSERT INTO order_items(order_id,product_id,description,quantity,unit_price_cop,total_cop) VALUES($1,$2,$3,$4,$5,$6)", [order.id,item.id,`${item.sku} · ${item.name}`,item.qty,item.unitPriceCop,item.unitPriceCop*item.qty]);
      await client.query("UPDATE products SET stock=stock-$2,updated_at=now() WHERE id=$1", [item.id,item.qty]);
    }
    await client.query("DELETE FROM shopping_cart_items WHERE cart_id=(SELECT id FROM shopping_carts WHERE user_id=$1)", [user.sub]);
    await client.query("UPDATE payment_attempts SET status='completed',provider_capture_id=$2,order_id=$3,updated_at=now() WHERE id=$1", [attempt.id,capture.captureId,order.id]);
    await client.query("INSERT INTO audit_logs(actor_id,organization_id,action,entity_type,entity_id,metadata) VALUES($1,$2,'payment.captured','order',$3,$4)", [user.sub,attempt.organization_id,order.id,{ provider: "paypal", providerOrderId, captureId: capture.captureId }]);
    await client.query("COMMIT");
    return { order, alreadyCaptured: false };
  } catch (error) {
    await client.query("ROLLBACK");
    await pool.query("UPDATE payment_attempts SET status='captured_review',provider_capture_id=$2,failure_reason=$3,updated_at=now() WHERE id=$1", [attempt.id,capture.captureId,error instanceof Error ? error.message.slice(0,1000) : "Error al registrar la orden"]);
    throw error;
  } finally {
    client.release();
  }
}