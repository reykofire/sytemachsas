import { randomUUID } from "node:crypto";

import { config } from "./config.js";
import { usdFromCop } from "./currency.js";

export { usdFromCop } from "./currency.js";

const baseUrl = config.PAYPAL_MODE === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

type PayPalCapture = { id?: string; status?: string; amount?: { currency_code?: string; value?: string } };
type PayPalOrder = {
  id?: string;
  status?: string;
  purchase_units?: Array<{ payments?: { captures?: PayPalCapture[] } }>;
  details?: Array<{ description?: string }>;
  message?: string;
};

export const paypalEnabled = Boolean(config.PAYPAL_CLIENT_ID && config.PAYPAL_CLIENT_SECRET);

function paymentError(message: string, statusCode = 502) {
  return Object.assign(new Error(message), { statusCode });
}

async function accessToken() {
  if (!paypalEnabled) throw paymentError("PayPal aún no está configurado", 503);
  const credentials = Buffer.from(`${config.PAYPAL_CLIENT_ID}:${config.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json() as { access_token?: string; error_description?: string };
  if (!response.ok || !body.access_token) throw paymentError(body.error_description || "No fue posible autenticar con PayPal");
  return body.access_token;
}

async function paypalRequest(path: string, method: "GET" | "POST", body?: unknown, requestId: string = randomUUID()) {
  const token = await accessToken();
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": requestId,
      Prefer: "return=representation",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20_000),
  });
  const result = await response.json() as PayPalOrder;
  if (!response.ok) throw paymentError(result.details?.[0]?.description || result.message || "PayPal rechazó la operación", response.status >= 500 ? 502 : 422);
  return result;
}

export async function createPayPalOrder(attemptId: string, amountUsd: string, totalCop: number) {
  const order = await paypalRequest("/v2/checkout/orders", "POST", {
    intent: "CAPTURE",
    purchase_units: [{
      custom_id: attemptId,
      description: `Compra HardSystem por ${new Intl.NumberFormat("es-CO").format(totalCop)} COP`,
      amount: { currency_code: "USD", value: amountUsd },
    }],
  }, attemptId);
  if (!order.id) throw paymentError("PayPal no devolvió el identificador de la orden");
  return order.id;
}

export async function capturePayPalOrder(providerOrderId: string, requestId: string) {
  const order = await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(providerOrderId)}/capture`, "POST", {}, requestId);
  const capture = order.purchase_units?.flatMap(unit => unit.payments?.captures || []).find(item => item.status === "COMPLETED");
  if (order.status !== "COMPLETED" || !capture?.id) throw paymentError("PayPal no confirmó la captura del pago", 409);
  return { captureId: capture.id, currency: capture.amount?.currency_code, amount: capture.amount?.value };
}