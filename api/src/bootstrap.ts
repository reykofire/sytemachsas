import argon2 from "argon2";

import { config } from "./config.js";
import { pool } from "./database.js";

if (!config.BOOTSTRAP_PASSWORD) throw new Error("BOOTSTRAP_PASSWORD is required");

const passwordHash = await argon2.hash(config.BOOTSTRAP_PASSWORD, { type: argon2.argon2id });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const ensureOrganization = async (name: string, email: string): Promise<string> => {
    const existing = await client.query<{ id: string }>("SELECT id FROM organizations WHERE name=$1 LIMIT 1", [name]);
    if (existing.rows[0]) return existing.rows[0].id;
    const result = await client.query<{ id: string }>(
      "INSERT INTO organizations(name,email) VALUES($1,$2) RETURNING id", [name, email]);
    return result.rows[0]!.id;
  };
  const hardSystemId = await ensureOrganization("HardSystem", "soporte@hardsystem.local");
  const customerId = await ensureOrganization("Empresa de demostración", "cliente@hardsystem.local");
  const users = [
    [hardSystemId, "admin@hardsystem.local", "Administrador DEV", "admin"],
    [hardSystemId, "agente@hardsystem.local", "Agente DEV", "agent"],
    [customerId, "cliente@hardsystem.local", "Cliente de demostración", "client"],
  ];
  for (const [organizationId, email, fullName, role] of users) {
    await client.query(
      `INSERT INTO users (organization_id,email,password_hash,full_name,role)
       VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (lower(email)) DO UPDATE SET password_hash=EXCLUDED.password_hash,organization_id=EXCLUDED.organization_id,full_name=EXCLUDED.full_name,role=EXCLUDED.role,is_active=true`,
      [organizationId, email, passwordHash, fullName, role]);
  }
  await client.query("COMMIT");
  console.info("Bootstrap accounts are ready");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}