import type { PoolClient } from "pg";

import { pool } from "./database.js";

export type CartItemInput = { id: string; qty: number };
type CartMode = "merge" | "replace";

async function ensureCart(client: PoolClient, userId: string) {
  await client.query("INSERT INTO shopping_carts(user_id) VALUES($1) ON CONFLICT (user_id) DO NOTHING", [userId]);
  const result = await client.query("SELECT id FROM shopping_carts WHERE user_id=$1 FOR UPDATE", [userId]);
  return result.rows[0].id as string;
}

async function reconcileCart(client: PoolClient, cartId: string) {
  await client.query("DELETE FROM shopping_cart_items ci WHERE ci.cart_id=$1 AND NOT EXISTS (SELECT 1 FROM products p WHERE p.id=ci.product_id AND p.is_active=true AND p.stock>0)", [cartId]);
  await client.query("UPDATE shopping_cart_items ci SET quantity=LEAST(ci.quantity,p.stock),updated_at=now() FROM products p WHERE ci.cart_id=$1 AND p.id=ci.product_id AND ci.quantity>p.stock", [cartId]);
  const result = await client.query(`SELECT ci.product_id id,ci.quantity qty,p.price_cop
    FROM shopping_cart_items ci JOIN products p ON p.id=ci.product_id
    WHERE ci.cart_id=$1 ORDER BY ci.added_at`, [cartId]);
  const items = result.rows.map(item => ({ id: item.id as string, qty: Number(item.qty) }));
  const subtotal = result.rows.reduce((sum, item) => sum + Number(item.price_cop) * Number(item.qty), 0);
  return { items, subtotal, currency: "COP" as const };
}

async function transactCart(userId: string, operation: (client: PoolClient, cartId: string) => Promise<void>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cartId = await ensureCart(client, userId);
    await operation(client, cartId);
    const cart = await reconcileCart(client, cartId);
    await client.query("UPDATE shopping_carts SET updated_at=now() WHERE id=$1", [cartId]);
    await client.query("COMMIT");
    return cart;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function getPersistentCart(userId: string) {
  return transactCart(userId, async () => undefined);
}

export function writePersistentCart(userId: string, items: CartItemInput[], mode: CartMode) {
  return transactCart(userId, async (client, cartId) => {
    if (mode === "replace") await client.query("DELETE FROM shopping_cart_items WHERE cart_id=$1", [cartId]);
    for (const item of items) {
      if (mode === "merge") {
        await client.query(`INSERT INTO shopping_cart_items(cart_id,product_id,quantity)
          SELECT $1,p.id,LEAST($3,p.stock) FROM products p WHERE p.id=$2 AND p.is_active=true AND p.stock>0
          ON CONFLICT (cart_id,product_id) DO UPDATE SET
            quantity=LEAST(shopping_cart_items.quantity+EXCLUDED.quantity,(SELECT stock FROM products WHERE id=EXCLUDED.product_id)),updated_at=now()`, [cartId, item.id, item.qty]);
      } else {
        await client.query(`INSERT INTO shopping_cart_items(cart_id,product_id,quantity)
          SELECT $1,p.id,LEAST($3,p.stock) FROM products p WHERE p.id=$2 AND p.is_active=true AND p.stock>0
          ON CONFLICT (cart_id,product_id) DO UPDATE SET quantity=EXCLUDED.quantity,updated_at=now()`, [cartId, item.id, item.qty]);
      }
    }
  });
}