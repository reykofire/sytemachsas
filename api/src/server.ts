import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import argon2 from "argon2";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import PDFDocument from "pdfkit";
import sharp from "sharp";
import { z } from "zod";

import { canAccessOrganization, organizationScope, ticketScope, type Role } from "./access.js";
import { getPersistentCart, writePersistentCart } from "./cart.js";
import { captureCheckout, createCheckout, paypalCheckoutConfig } from "./checkout.js";
import { config } from "./config.js";
import { pool } from "./database.js";
import { mailerEnabled, notifyContactConfirmation, notifyContactRequest, notifyStaffTicketCreated, notifyTicketClosed, notifyTicketCreated } from "./mailer.js";

type AuthUser = { sub: string; organizationId: string | null; organizationName?: string; role: Role; name: string };
declare module "@fastify/jwt" { interface FastifyJWT { payload: AuthUser; user: AuthUser } }

const app = Fastify({ logger: { level: config.NODE_ENV === "production" ? "info" : "debug" }, trustProxy: true });
await app.register(jwt, { secret: config.JWT_SECRET, sign: { expiresIn: "8h" } });
await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
await app.register(rateLimit, { global: true, max: 180, timeWindow: "1 minute" });
await mkdir(config.ATTACHMENTS_PATH, { recursive: true });
app.log.info({ enabled: mailerEnabled, host: config.SMTP_HOST, user: config.SMTP_USER }, "Configuración de correo cargada");

const imageTypes = new Map([["image/jpeg", ".jpg"], ["image/png", ".png"], ["image/webp", ".webp"]]);
const closureCauses = ["hardware_failure", "software_issue", "configuration", "user_guidance", "preventive_maintenance", "parts_replacement", "network_issue", "security_incident", "other"] as const;
const closureCauseLabels: Record<(typeof closureCauses)[number], string> = {
  hardware_failure: "Falla de hardware", software_issue: "Problema de software", configuration: "Configuración",
  user_guidance: "Orientación al usuario", preventive_maintenance: "Mantenimiento preventivo", parts_replacement: "Reemplazo de repuesto",
  network_issue: "Problema de red", security_incident: "Incidente de seguridad", other: "Otra causa",
};
const reopenCauses = ["customer_request", "recurrence", "incomplete_solution", "new_evidence", "other"] as const;
const reopenCauseLabels: Record<(typeof reopenCauses)[number], string> = {
  customer_request: "Solicitud del cliente", recurrence: "Reincidencia del problema", incomplete_solution: "Solución incompleta",
  new_evidence: "Nueva evidencia", other: "Otra causa",
};
const safeWebUrl = z.string().trim().min(1).max(500).refine(value => {
  try { return ["http:", "https:"].includes(new URL(value, "https://hardsystem.invalid").protocol); }
  catch { return false; }
}, { message: "La URL debe usar una ruta local, HTTP o HTTPS" });
const commerceProductSchema = z.object({ sku: z.string().trim().min(2).max(60), name: z.string().trim().min(2).max(180), description: z.string().trim().max(2000).default(""), category: z.string().trim().min(2).max(100), priceCop: z.number().int().min(0), stock: z.number().int().min(0), minimumStock: z.number().int().min(0).default(0), imageUrl: safeWebUrl.nullable().optional(), icon: z.string().trim().max(40).default("box"), specifications: z.record(z.string(), z.string()).default({}), isFeatured: z.boolean().default(false), isActive: z.boolean().default(true) });
const promotionSchema = z.object({ badge: z.string().trim().min(2).max(120), title: z.string().trim().min(4).max(120), accent: z.string().trim().min(2).max(50), description: z.string().trim().min(10).max(500), primaryLabel: z.string().trim().min(2).max(60), primaryUrl: safeWebUrl, secondaryLabel: z.string().trim().min(2).max(60), secondaryUrl: safeWebUrl, noteLabel: z.string().trim().min(2).max(40), noteText: z.string().trim().min(2).max(240), imageUrl: safeWebUrl, imageAlt: z.string().trim().min(2).max(180), isActive: z.boolean(), startsAt: z.string().datetime().nullable().optional(), endsAt: z.string().datetime().nullable().optional() });
const cartSchema = z.object({ items: z.array(z.object({ id: z.string().uuid(), qty: z.number().int().min(1).max(999) })).max(100) });

const auth = async (request: FastifyRequest, reply: FastifyReply) => {
  try { await request.jwtVerify(); } catch { return reply.code(401).send({ error: "No autorizado" }); }
  const result = await pool.query("SELECT u.organization_id,u.full_name,u.role,u.account_status,u.suspended_until,o.name organization_name FROM users u LEFT JOIN organizations o ON o.id=u.organization_id WHERE u.id=$1", [request.user.sub]);
  const user = result.rows[0];
  if (!user) return reply.code(401).send({ error: "Usuario no disponible" });
  if (user.account_status === "suspended" && user.suspended_until && new Date(user.suspended_until) <= new Date()) {
    await pool.query("UPDATE users SET account_status='active',is_active=true,suspended_until=NULL,status_reason=NULL,updated_at=now() WHERE id=$1", [request.user.sub]);
    user.account_status = "active";
  }
  if (user.account_status !== "active") return reply.code(401).send({ error: user.account_status === "suspended" ? "Cuenta suspendida temporalmente" : "Cuenta inhabilitada" });
  request.user.organizationId = user.organization_id; request.user.organizationName = user.organization_name; request.user.name = user.full_name; request.user.role = user.role;
};
const staff = async (request: FastifyRequest, reply: FastifyReply) => {
  await auth(request, reply);
  if (!reply.sent && request.user.role === "client") return reply.code(403).send({ error: "Permisos insuficientes" });
};
const admin = async (request: FastifyRequest, reply: FastifyReply) => {
  await auth(request, reply);
  if (!reply.sent && request.user.role !== "admin") return reply.code(403).send({ error: "Permisos de administrador requeridos" });
};
app.get("/api/health/live", async () => ({ status: "ok" }));
app.get("/api/health/ready", async (_request, reply) => {
  try { await pool.query("SELECT 1"); return { status: "ready", database: "connected" }; }
  catch (error) { app.log.error(error); return reply.code(503).send({ status: "unavailable" }); }
});

app.get("/api/commerce", async () => {
  const [products, promotions] = await Promise.all([
    pool.query("SELECT id,sku,name,description,category,price_cop,stock,minimum_stock,image_url,icon,specifications,is_featured,is_active FROM products WHERE is_active=true ORDER BY is_featured DESC,name"),
    pool.query("SELECT id,slot,badge,title,accent,description,primary_label,primary_url,secondary_label,secondary_url,note_label,note_text,image_url,image_alt,is_active,starts_at,ends_at FROM commerce_promotions WHERE is_active=true AND (starts_at IS NULL OR starts_at<=now()) AND (ends_at IS NULL OR ends_at>=now()) ORDER BY slot"),
  ]);
  return { products: products.rows, promotions: promotions.rows };
});
app.get("/api/admin/commerce", { preHandler: admin }, async () => {
  const [products, promotions] = await Promise.all([
    pool.query("SELECT id,sku,name,description,category,price_cop,stock,minimum_stock,image_url,icon,specifications,is_featured,is_active FROM products ORDER BY name"),
    pool.query("SELECT id,slot,badge,title,accent,description,primary_label,primary_url,secondary_label,secondary_url,note_label,note_text,image_url,image_alt,is_active,starts_at,ends_at FROM commerce_promotions ORDER BY slot"),
  ]);
  return { products: products.rows, promotions: promotions.rows };
});
app.post("/api/admin/commerce/images", { preHandler: admin }, async (request, reply) => {
  const file = await request.file(); if (!file) return reply.code(400).send({ error: "Seleccione una imagen" }); if (!imageTypes.has(file.mimetype)) return reply.code(415).send({ error: "Solo se permiten imágenes JPEG, PNG o WebP" });
  const key = `commerce-${randomUUID()}.webp`; const image = await sharp(await file.toBuffer()).rotate().resize({ width: 1400, height: 1000, fit: "inside", withoutEnlargement: true }).webp({ quality: 88 }).toBuffer(); await writeFile(resolve(config.ATTACHMENTS_PATH,key),image,{flag:"wx"});
  await pool.query("INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,metadata) VALUES($1,'upload','commerce_image',$2,$3)",[request.user.sub,key,{ originalName:file.filename,size:image.length }]); return reply.code(201).send({ url:`/api/commerce/images/${key}` });
});
app.get("/api/commerce/images/:key", async (request, reply) => { const { key }=z.object({key:z.string().regex(/^commerce-[0-9a-f-]+\.webp$/)}).parse(request.params); reply.header("Content-Type","image/webp").header("Cache-Control","public, max-age=31536000, immutable"); return reply.send(createReadStream(resolve(config.ATTACHMENTS_PATH,key))); });
app.post("/api/admin/products", { preHandler: admin }, async (request, reply) => {
  const body = commerceProductSchema.parse(request.body);
  const result = await pool.query("INSERT INTO products(sku,name,description,category,price_cop,stock,minimum_stock,image_url,icon,specifications,is_featured,is_active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *", [body.sku,body.name,body.description,body.category,body.priceCop,body.stock,body.minimumStock,body.imageUrl??null,body.icon,body.specifications,body.isFeatured,body.isActive]);
  await pool.query("INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,metadata) VALUES($1,'create','product',$2,$3)", [request.user.sub,result.rows[0].id,{ sku: body.sku }]);
  return reply.code(201).send(result.rows[0]);
});
app.patch("/api/admin/products/:id", { preHandler: admin }, async (request, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const body = commerceProductSchema.parse(request.body);
  const result = await pool.query("UPDATE products SET sku=$2,name=$3,description=$4,category=$5,price_cop=$6,stock=$7,minimum_stock=$8,image_url=$9,icon=$10,specifications=$11,is_featured=$12,is_active=$13 WHERE id=$1 RETURNING *", [id,body.sku,body.name,body.description,body.category,body.priceCop,body.stock,body.minimumStock,body.imageUrl??null,body.icon,body.specifications,body.isFeatured,body.isActive]);
  if (!result.rowCount) return reply.code(404).send({ error: "Producto no encontrado" }); await pool.query("INSERT INTO audit_logs(actor_id,action,entity_type,entity_id) VALUES($1,'update','product',$2)", [request.user.sub,id]); return result.rows[0];
});
app.delete("/api/admin/products/:id", { preHandler: admin }, async (request, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const result = await pool.query("DELETE FROM products WHERE id=$1 RETURNING id", [id]); if (!result.rowCount) return reply.code(404).send({ error: "Producto no encontrado" }); await pool.query("INSERT INTO audit_logs(actor_id,action,entity_type,entity_id) VALUES($1,'delete','product',$2)", [request.user.sub,id]); return reply.code(204).send();
});
app.patch("/api/admin/promotions/:slot", { preHandler: admin }, async (request, reply) => {
  const { slot } = z.object({ slot: z.coerce.number().int().min(1).max(2) }).parse(request.params); const body = promotionSchema.refine(value => !value.startsAt || !value.endsAt || new Date(value.endsAt)>new Date(value.startsAt), { message: "La fecha final debe ser posterior a la inicial" }).parse(request.body);
  const result = await pool.query("UPDATE commerce_promotions SET badge=$2,title=$3,accent=$4,description=$5,primary_label=$6,primary_url=$7,secondary_label=$8,secondary_url=$9,note_label=$10,note_text=$11,image_url=$12,image_alt=$13,is_active=$14,starts_at=$15,ends_at=$16,updated_by=$17 WHERE slot=$1 RETURNING *", [slot,body.badge,body.title,body.accent,body.description,body.primaryLabel,body.primaryUrl,body.secondaryLabel,body.secondaryUrl,body.noteLabel,body.noteText,body.imageUrl,body.imageAlt,body.isActive,body.startsAt??null,body.endsAt??null,request.user.sub]);
  await pool.query("INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,metadata) VALUES($1,'publish','promotion',$2,$3)", [request.user.sub,result.rows[0].id,{ slot }]); return result.rows[0];
});

app.post("/api/contact-requests", { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } }, async (request, reply) => {
  const body = z.object({ name: z.string().trim().min(2).max(120), company: z.string().trim().max(160).optional(), email: z.string().trim().email().max(240), phone: z.string().trim().min(7).max(40), service: z.string().trim().min(2).max(120), message: z.string().trim().min(10).max(5000), wantsPortalAccess: z.boolean().default(false) }).parse(request.body);
  const contact = { ...body, company: body.company ?? undefined };
  const staffRecipients = (await pool.query("SELECT email FROM users WHERE role IN ('agent','supervisor','admin') AND account_status='active' AND email IS NOT NULL ORDER BY role,email")).rows.map(user => user.email as string);
  if (!staffRecipients.length) staffRecipients.push(config.SMTP_USER);
  let staffEmailSent = false;
  let requesterEmailSent = false;
  try { staffEmailSent = await notifyContactRequest(contact, staffRecipients); } catch (error) { app.log.error({ err: error }, "No fue posible enviar la solicitud al equipo interno"); }
  try { requesterEmailSent = await notifyContactConfirmation(contact); } catch (error) { app.log.error({ err: error, email: contact.email }, "No fue posible enviar la confirmación de contacto"); }
  if (!staffEmailSent && !requesterEmailSent) return reply.code(503).send({ error: "No fue posible enviar la solicitud en este momento" });
  return reply.code(202).send({ message: "Solicitud recibida", notification: { staffEmailSent, requesterEmailSent } });
});

app.post("/api/auth/login", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
  const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(request.body);
  const result = await pool.query("SELECT u.id,u.organization_id,u.email,u.password_hash,u.full_name,u.role,u.account_status,u.suspended_until,o.name organization_name FROM users u LEFT JOIN organizations o ON o.id=u.organization_id WHERE u.email=lower($1)", [body.email]);
  const user = result.rows[0];
  if (user?.account_status === "suspended" && user.suspended_until && new Date(user.suspended_until) <= new Date()) {
    await pool.query("UPDATE users SET account_status='active',is_active=true,suspended_until=NULL,status_reason=NULL,updated_at=now() WHERE id=$1", [user.id]); user.account_status = "active";
  }
  if (!user || user.account_status !== "active" || !(await argon2.verify(user.password_hash, body.password))) return reply.code(401).send({ error: user?.account_status === "suspended" ? "Cuenta suspendida temporalmente" : user?.account_status === "disabled" ? "Cuenta inhabilitada" : "Credenciales incorrectas" });
  const payload: AuthUser = { sub: user.id, organizationId: user.organization_id, organizationName: user.organization_name, role: user.role, name: user.full_name };
  await pool.query("UPDATE users SET last_login_at=now() WHERE id=$1", [user.id]);
  return { token: app.jwt.sign(payload), user: { ...payload, email: user.email } };
});
app.get("/api/me", { preHandler: auth }, async (request) => ({ user: request.user }));
app.get("/api/cart", { preHandler: auth }, async (request) => getPersistentCart(request.user.sub));
app.put("/api/cart", { preHandler: auth }, async (request) => writePersistentCart(request.user.sub, cartSchema.parse(request.body).items, "replace"));
app.post("/api/cart/merge", { preHandler: auth }, async (request) => writePersistentCart(request.user.sub, cartSchema.parse(request.body).items, "merge"));
app.get("/api/payments/paypal/config", async () => paypalCheckoutConfig());
app.post("/api/payments/paypal/orders", { preHandler: auth, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => reply.code(201).send(await createCheckout(request.user)));
app.post("/api/payments/paypal/orders/:id/capture", { preHandler: auth, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request) => {
  const { id } = z.object({ id: z.string().min(5).max(100) }).parse(request.params);
  return captureCheckout(request.user, id);
});

app.get("/api/tickets", { preHandler: auth }, async (request) => {
  const filter = ticketScope(request.user, "t", 1);
  const result = await pool.query(
    `SELECT t.id,t.ticket_number,t.requester_id,t.subject,t.description,t.category,t.priority,t.status,t.created_at,t.updated_at,
      o.name organization_name,a.asset_tag,concat_ws(' ',a.brand,a.model) asset_name,u.full_name assigned_name,u.id assigned_to
         FROM tickets t LEFT JOIN organizations o ON o.id=t.organization_id LEFT JOIN assets a ON a.id=t.asset_id
    LEFT JOIN users u ON u.id=t.assigned_to WHERE 1=1${filter.sql} ORDER BY t.created_at DESC`, filter.params);
  return { items: result.rows };
});

app.post("/api/tickets", { preHandler: auth }, async (request, reply) => {
  const body = z.object({ clientId: z.string().uuid().optional(), subject: z.string().min(5).max(180), description: z.string().min(10).max(10000), priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"), category: z.string().min(2).max(80).default("support"), assetId: z.string().uuid().nullable().optional() }).parse(request.body);
  const clientId = request.user.role === "client" ? request.user.sub : body.clientId;
  if (!clientId) return reply.code(400).send({ error: "Seleccione el cliente del ticket" });
  const clientResult = await pool.query("SELECT id,organization_id FROM users WHERE id=$1 AND role='client' AND account_status='active'", [clientId]);
  if (!clientResult.rowCount) return reply.code(400).send({ error: "El cliente seleccionado no está disponible" });
  const organizationId = clientResult.rows[0].organization_id as string | null;
  if (!canAccessOrganization(request.user, organizationId)) return reply.code(403).send({ error: "No puede crear tickets para otra empresa" });
  if (body.assetId && !(await pool.query("SELECT 1 FROM assets WHERE id=$1 AND owner_user_id=$2 AND organization_id IS NOT DISTINCT FROM $3", [body.assetId, clientId, organizationId])).rowCount) return reply.code(400).send({ error: "El equipo no pertenece al usuario seleccionado" });
  const result = await pool.query(
    `INSERT INTO tickets(organization_id,requester_id,asset_id,subject,description,priority,category)
     VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [organizationId, clientId, body.assetId ?? null, body.subject, body.description, body.priority, body.category]);
  await pool.query("INSERT INTO ticket_events(ticket_id,actor_id,event_type,new_value) VALUES($1,$2,'created',$3)", [result.rows[0].id, request.user.sub, { status: "open" }]);
  const notification = (await pool.query(`SELECT t.ticket_number,t.subject,t.description,t.priority,t.status,u.full_name requester_name,u.email requester_email,u.role requester_role,a.asset_tag,concat_ws(' ',a.brand,a.model) asset_name FROM tickets t JOIN users u ON u.id=t.requester_id LEFT JOIN assets a ON a.id=t.asset_id WHERE t.id=$1`, [result.rows[0].id])).rows[0];
  let requesterEmailSent = false;
  try { requesterEmailSent = await notifyTicketCreated(notification); } catch (error) { app.log.error({ err: error, ticketId: result.rows[0].id }, "No fue posible enviar el correo al cliente"); }
  let staffEmailSent: boolean | null = null;
  if (notification.requester_role === "client") {
    staffEmailSent = false;
    try { const staffRecipients = (await pool.query("SELECT email FROM users WHERE role IN ('agent','supervisor','admin') AND account_status='active' AND email IS NOT NULL ORDER BY role,email")).rows.map(user => user.email); staffEmailSent = await notifyStaffTicketCreated(notification, staffRecipients); } catch (error) { app.log.error({ err: error, ticketId: result.rows[0].id }, "No fue posible enviar el aviso al equipo interno"); }
  }
  return reply.code(201).send({ ...result.rows[0], notification: { requesterEmailSent, staffEmailSent } });
});

app.patch("/api/tickets/:id", { preHandler: staff }, async (request, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const body = z.object({ status: z.enum(["open", "in_progress", "pending_customer", "pending_parts", "resolved", "closed"]).optional(), priority: z.enum(["low", "medium", "high", "urgent"]).optional(), assignedTo: z.string().uuid().nullable().optional(), closureCause: z.enum(closureCauses).optional(), closureNote: z.string().trim().min(31).max(10000).optional(), reopenCause: z.enum(reopenCauses).optional(), reopenNote: z.string().trim().min(31).max(10000).optional() })
    .refine((value) => Object.keys(value).length > 0)
    .refine((value) => value.status !== "closed" || (value.closureCause && value.closureNote), { message: "Para cerrar seleccione una causa y escriba un soporte de más de 30 caracteres" })
    .parse(request.body);
  if (request.user.role === "agent" && Object.hasOwn(body, "assignedTo")) return reply.code(403).send({ error: "Solo supervisores y administradores pueden asignar técnicos" });
  if (body.assignedTo && !(await pool.query("SELECT 1 FROM users WHERE id=$1 AND role IN ('agent','supervisor','admin') AND account_status='active'", [body.assignedTo])).rowCount) return reply.code(400).send({ error: "El técnico seleccionado no está disponible" });
  const filter = ticketScope(request.user);
  const before = await pool.query(`SELECT status,priority,assigned_to FROM tickets t WHERE t.id=$1${filter.sql}`, [id, ...filter.params]);
  if (!before.rows[0]) return reply.code(404).send({ error: "Ticket no encontrado" });
  if (before.rows[0].status === "closed" && body.status !== "closed" && (!body.reopenCause || !body.reopenNote)) return reply.code(400).send({ error: "Para reabrir seleccione una causa y escriba un soporte de más de 30 caracteres" });
  if (before.rows[0].status === "closed" && body.status !== "closed") {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query("UPDATE tickets SET status=$2,priority=COALESCE($3,priority),updated_at=now() WHERE id=$1 RETURNING *", [id, body.status, body.priority ?? null]);
      const comment = await client.query("INSERT INTO ticket_comments(ticket_id,author_id,body,is_internal) VALUES($1,$2,$3,false) RETURNING id", [id, request.user.sub, `Reapertura · ${reopenCauseLabels[body.reopenCause!]}. ${body.reopenNote}`]);
      await client.query("INSERT INTO ticket_events(ticket_id,actor_id,event_type,previous_value,new_value) VALUES($1,$2,'reopened',$3,$4)", [id, request.user.sub, before.rows[0], { status: body.status, reopenCause: body.reopenCause, reopenNote: body.reopenNote, commentId: comment.rows[0].id }]);
      await client.query("COMMIT");
      return { ...result.rows[0], reopenCommentId: comment.rows[0].id };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
  if (body.status === "closed") {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `UPDATE tickets SET status='closed',priority=COALESCE($2,priority),assigned_to=CASE WHEN $3 THEN $4::uuid ELSE assigned_to END,
          closure_cause=$5,closure_note=$6,closed_by=$7,closed_at=now(),updated_at=now() WHERE id=$1 RETURNING *`,
        [id, body.priority ?? null, Object.hasOwn(body, "assignedTo"), body.assignedTo ?? null, body.closureCause, body.closureNote, request.user.sub]);
      const comment = await client.query(
        "INSERT INTO ticket_comments(ticket_id,author_id,body,is_internal) VALUES($1,$2,$3,false) RETURNING id",
        [id, request.user.sub, `Cierre · ${closureCauseLabels[body.closureCause!]}. ${body.closureNote}`]);
      await client.query("INSERT INTO ticket_events(ticket_id,actor_id,event_type,previous_value,new_value) VALUES($1,$2,'closed',$3,$4)", [id, request.user.sub, before.rows[0], { status: "closed", closureCause: body.closureCause, closureNote: body.closureNote, commentId: comment.rows[0].id }]);
      await client.query("COMMIT");
      const notification = (await pool.query(`SELECT t.ticket_number,t.subject,t.description,t.priority,t.status,t.closure_cause,t.closure_note,t.closed_at,u.full_name requester_name,u.email requester_email,a.asset_tag,concat_ws(' ',a.brand,a.model) asset_name FROM tickets t JOIN users u ON u.id=t.requester_id LEFT JOIN assets a ON a.id=t.asset_id WHERE t.id=$1`, [id])).rows[0];
      try { await notifyTicketClosed(notification); } catch (error) { app.log.error({ err: error, ticketId: id }, "No fue posible enviar el correo de ticket cerrado"); }
      return { ...result.rows[0], closureCommentId: comment.rows[0].id };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
  const result = await pool.query(
    `UPDATE tickets SET status=COALESCE($2,status),priority=COALESCE($3,priority),
      assigned_to=CASE WHEN $4 THEN $5::uuid ELSE assigned_to END,
      resolved_at=CASE WHEN $2='resolved' THEN now() ELSE resolved_at END,
      closed_at=CASE WHEN $2='closed' THEN now() ELSE closed_at END WHERE id=$1 RETURNING *`,
    [id, body.status ?? null, body.priority ?? null, Object.hasOwn(body, "assignedTo"), body.assignedTo ?? null]);
  await pool.query("INSERT INTO ticket_events(ticket_id,actor_id,event_type,previous_value,new_value) VALUES($1,$2,'updated',$3,$4)", [id, request.user.sub, before.rows[0], body]);
  return result.rows[0];
});

app.get("/api/tickets/:id/comments", { preHandler: auth }, async (request, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const filter = ticketScope(request.user);
  if (!(await pool.query(`SELECT 1 FROM tickets t WHERE t.id=$1${filter.sql}`, [id, ...filter.params])).rowCount) return reply.code(404).send({ error: "Ticket no encontrado" });
  const result = await pool.query(`SELECT c.id,c.author_id,c.body,c.is_internal,c.created_at,u.full_name author,
    COALESCE(json_agg(json_build_object('id',a.id,'name',a.original_name,'contentType',a.content_type,'size',a.size_bytes) ORDER BY a.created_at) FILTER (WHERE a.id IS NOT NULL),'[]') attachments
    FROM ticket_comments c JOIN users u ON u.id=c.author_id LEFT JOIN attachments a ON a.comment_id=c.id
    WHERE c.ticket_id=$1 AND ($2::boolean=false OR c.is_internal=false) GROUP BY c.id,u.full_name ORDER BY c.created_at`, [id, request.user.role === "client"]);
  return { items: result.rows };
});
app.post("/api/tickets/:id/comments", { preHandler: auth }, async (request, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const filter = ticketScope(request.user);
  const body = z.object({ body: z.string().min(1).max(10000), internal: z.boolean().default(false) }).parse(request.body);
  if (request.user.role === "client" && body.internal) return reply.code(403).send({ error: "Permisos insuficientes" });
  if (!(await pool.query(`SELECT 1 FROM tickets t WHERE t.id=$1${filter.sql}`, [id, ...filter.params])).rowCount) return reply.code(404).send({ error: "Ticket no encontrado" });
  return reply.code(201).send((await pool.query("INSERT INTO ticket_comments(ticket_id,author_id,body,is_internal) VALUES($1,$2,$3,$4) RETURNING *", [id, request.user.sub, body.body, body.internal])).rows[0]);
});
app.post("/api/tickets/:id/comments/:commentId/attachments", { preHandler: auth }, async (request, reply) => {
  const { id, commentId } = z.object({ id: z.string().uuid(), commentId: z.string().uuid() }).parse(request.params);
  const filter = ticketScope(request.user, "t", 3);
  const owner = await pool.query(`SELECT t.organization_id,c.is_internal FROM tickets t JOIN ticket_comments c ON c.ticket_id=t.id WHERE t.id=$1 AND c.id=$2${filter.sql}`, [id, commentId, ...filter.params]);
  if (!owner.rows[0] || (request.user.role === "client" && owner.rows[0].is_internal)) return reply.code(404).send({ error: "Comentario no encontrado" });
  const file = await request.file();
  if (!file) return reply.code(400).send({ error: "Seleccione una imagen" });
  const extension = imageTypes.get(file.mimetype);
  if (!extension) return reply.code(415).send({ error: "Solo se permiten imágenes JPEG, PNG o WebP" });
  const buffer = await file.toBuffer();
  const storageKey = `${randomUUID()}${extension}`;
  await writeFile(resolve(config.ATTACHMENTS_PATH, storageKey), buffer, { flag: "wx" });
  const result = await pool.query(`INSERT INTO attachments(organization_id,ticket_id,comment_id,uploaded_by,original_name,storage_key,content_type,size_bytes,sha256)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,original_name,content_type,size_bytes`,
    [owner.rows[0].organization_id, id, commentId, request.user.sub, file.filename, storageKey, file.mimetype, buffer.length, createHash("sha256").update(buffer).digest("hex")]);
  return reply.code(201).send(result.rows[0]);
});
app.get("/api/attachments/:id", { preHandler: auth }, async (request, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const filter = ticketScope(request.user, "t");
  const result = await pool.query(`SELECT a.storage_key,a.original_name,a.content_type,c.is_internal FROM attachments a JOIN tickets t ON t.id=a.ticket_id LEFT JOIN ticket_comments c ON c.id=a.comment_id WHERE a.id=$1${filter.sql}`, [id, ...filter.params]);
  const attachment = result.rows[0];
  if (!attachment || (request.user.role === "client" && attachment.is_internal)) return reply.code(404).send({ error: "Imagen no encontrada" });
  reply.header("Content-Type", attachment.content_type).header("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(attachment.original_name)}`);
  return reply.send(createReadStream(resolve(config.ATTACHMENTS_PATH, attachment.storage_key)));
});
app.get("/api/tickets/:id/events", { preHandler: auth }, async (request, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const filter = ticketScope(request.user);
  if (!(await pool.query(`SELECT 1 FROM tickets t WHERE t.id=$1${filter.sql}`, [id, ...filter.params])).rowCount) return reply.code(404).send({ error: "Ticket no encontrado" });
  return { items: (await pool.query("SELECT e.id,e.event_type,e.previous_value,e.new_value,e.created_at,u.full_name actor FROM ticket_events e LEFT JOIN users u ON u.id=e.actor_id WHERE e.ticket_id=$1 ORDER BY e.created_at DESC", [id])).rows };
});

app.get("/api/reports", { preHandler: auth }, async (request) => {
  const filter = ticketScope(request.user, "t", 1);
  const result = await pool.query(`SELECT t.id,t.ticket_number,t.subject,t.priority,t.status,t.category,t.closed_at,t.closure_cause,
      requester.full_name requester_name,requester.email requester_email,concat_ws(' ',a.brand,a.model) asset_name,a.asset_tag,
      assigned.full_name assigned_name
    FROM tickets t JOIN users requester ON requester.id=t.requester_id
    LEFT JOIN assets a ON a.id=t.asset_id LEFT JOIN users assigned ON assigned.id=t.assigned_to
    WHERE 1=1${filter.sql} ORDER BY COALESCE(t.closed_at,t.updated_at,t.created_at) DESC`, filter.params);
  return { items: result.rows };
});

app.get("/api/reports/statistics", { preHandler: auth }, async (request) => {
  const filters = z.object({ ticketStatus: z.enum(["all", "open", "in_progress", "pending", "resolved", "closed"]).default("all"), assetStatus: z.enum(["all", "active", "closed", "none"]).default("all"), period: z.enum(["all", "today", "7d", "30d"]).default("all") }).parse(request.query);
  const ticketFilter = ticketScope(request.user, "t", 1);
  const ticketParams: unknown[] = [...ticketFilter.params];
  const ticketConditions = [`1=1${ticketFilter.sql}`];
  if (filters.ticketStatus !== "all") { const statuses = filters.ticketStatus === "pending" ? ["pending_customer", "pending_parts"] : [filters.ticketStatus]; ticketParams.push(statuses); ticketConditions.push(`t.status = ANY($${ticketParams.length})`); }
  if (filters.period !== "all") { const days = filters.period === "today" ? 1 : filters.period === "30d" ? 30 : 7; ticketParams.push(days); ticketConditions.push(`t.created_at >= CURRENT_DATE - ($${ticketParams.length}::int - 1)`); }
  const assetParams: unknown[] = request.user.role === "client" ? [request.user.sub] : [];
  const assetConditions = request.user.role === "client" ? " WHERE a.owner_user_id=$1" : "";
  const [summaryResult, priorityResult, ticketDetailResult, assetResult] = await Promise.all([
    pool.query(`SELECT t.status,COUNT(*)::int count FROM tickets t WHERE ${ticketConditions.join(" AND ")} GROUP BY t.status ORDER BY t.status`, ticketParams),
    pool.query(`SELECT t.priority,COUNT(*)::int count FROM tickets t WHERE ${ticketConditions.join(" AND ")} GROUP BY t.priority ORDER BY t.priority`, ticketParams),
    pool.query(`SELECT t.ticket_number,t.subject,t.status,t.priority,t.created_at,concat_ws(' ',a.brand,a.model) asset_name,a.asset_tag FROM tickets t LEFT JOIN assets a ON a.id=t.asset_id WHERE ${ticketConditions.join(" AND ")} ORDER BY t.created_at DESC`, ticketParams),
    pool.query(`SELECT a.id,a.asset_tag,a.asset_type,a.brand,a.model,a.status,a.location,COUNT(t.id)::int incident_count,COUNT(t.id) FILTER (WHERE t.status NOT IN ('resolved','closed'))::int active_incidents,COUNT(t.id) FILTER (WHERE t.status IN ('resolved','closed'))::int closed_incidents FROM assets a LEFT JOIN tickets t ON t.asset_id=a.id${assetConditions} GROUP BY a.id ORDER BY a.asset_tag`, assetParams),
  ]);
  const assets = assetResult.rows.filter(asset => filters.assetStatus === "all" || filters.assetStatus === "active" && asset.active_incidents > 0 || filters.assetStatus === "closed" && asset.incident_count > 0 && asset.active_incidents === 0 || filters.assetStatus === "none" && asset.incident_count === 0);
  return { filters, tickets: { byStatus: summaryResult.rows, byPriority: priorityResult.rows, total: summaryResult.rows.reduce((total, item) => total + item.count, 0), items: ticketDetailResult.rows }, assets: { byStatus: { all: assetResult.rows.length, active: assetResult.rows.filter(item => item.active_incidents > 0).length, closed: assetResult.rows.filter(item => item.incident_count > 0 && item.active_incidents === 0).length, none: assetResult.rows.filter(item => item.incident_count === 0).length }, items: assets } };
});

app.get("/api/reports/statistics.pdf", { preHandler: auth }, async (request, reply) => {
  const filters = z.object({ ticketStatus: z.enum(["all", "open", "in_progress", "pending", "resolved", "closed"]).default("all"), assetStatus: z.enum(["all", "active", "closed", "none"]).default("all"), period: z.enum(["all", "today", "7d", "30d"]).default("all") }).parse(request.query);
  const ticketFilter = ticketScope(request.user, "t", 1); const ticketParams: unknown[] = [...ticketFilter.params]; const conditions = [`1=1${ticketFilter.sql}`];
  if (filters.ticketStatus !== "all") { const statuses = filters.ticketStatus === "pending" ? ["pending_customer", "pending_parts"] : [filters.ticketStatus]; ticketParams.push(statuses); conditions.push(`t.status = ANY($${ticketParams.length})`); }
  if (filters.period !== "all") { const days = filters.period === "today" ? 1 : filters.period === "30d" ? 30 : 7; ticketParams.push(days); conditions.push(`t.created_at >= CURRENT_DATE - ($${ticketParams.length}::int - 1)`); }
  const assetParams: unknown[] = request.user.role === "client" ? [request.user.sub] : []; const assetScope = request.user.role === "client" ? " WHERE a.owner_user_id=$1" : "";
  const [summaryResult, ticketDetailResult, assetResult] = await Promise.all([
    pool.query(`SELECT t.status,COUNT(*)::int count FROM tickets t WHERE ${conditions.join(" AND ")} GROUP BY t.status ORDER BY t.status`, ticketParams),
    pool.query(`SELECT t.ticket_number,t.subject,t.status,t.priority,t.created_at,concat_ws(' ',a.brand,a.model) asset_name,a.asset_tag,u.full_name assigned_name FROM tickets t LEFT JOIN assets a ON a.id=t.asset_id LEFT JOIN users u ON u.id=t.assigned_to WHERE ${conditions.join(" AND ")} ORDER BY t.created_at DESC`, ticketParams),
    pool.query(`SELECT a.asset_tag,a.asset_type,a.brand,a.model,COUNT(t.id)::int incident_count,COUNT(t.id) FILTER (WHERE t.status NOT IN ('resolved','closed'))::int active_incidents,COUNT(t.id) FILTER (WHERE t.status IN ('resolved','closed'))::int closed_incidents FROM assets a LEFT JOIN tickets t ON t.asset_id=a.id${assetScope} GROUP BY a.id ORDER BY a.asset_tag`, assetParams),
  ]);
  const statusLabels: Record<string, string> = { open: "Abiertos", in_progress: "En proceso", pending_customer: "Pendiente cliente", pending_parts: "Pendiente repuesto", resolved: "Resueltos", closed: "Cerrados" };
  const priorityLabels: Record<string, string> = { low: "Baja", medium: "Media", high: "Alta", urgent: "Urgente" };
  const assetItems = assetResult.rows.filter(asset => filters.assetStatus === "all" || filters.assetStatus === "active" && asset.active_incidents > 0 || filters.assetStatus === "closed" && asset.incident_count > 0 && asset.active_incidents === 0 || filters.assetStatus === "none" && asset.incident_count === 0);
  const doc = new PDFDocument({ size: "A4", margin: 42, info: { Title: "Estadísticas operativas - HardSystem", Author: "HardSystem" } }); const chunks: Buffer[] = []; doc.on("data", chunk => chunks.push(chunk)); const complete = new Promise<Buffer>((resolveDocument, reject) => { doc.on("end", () => resolveDocument(Buffer.concat(chunks))); doc.on("error", reject); });
  const navy = "#16232f"; const red = "#c71920"; const gray = "#687681"; const line = "#dfe5e8"; const pale = "#f5f7f8"; const logoPath = resolve(process.cwd(), "Logo/logoHS01.png");
  try { doc.image(logoPath, 42, 34, { fit: [105, 34] }); } catch { doc.font("Helvetica-Bold").fontSize(15).fillColor(navy).text("HardSystem", 42, 43); } doc.font("Helvetica-Bold").fontSize(17).fillColor(navy).text("ESTADÍSTICAS OPERATIVAS", 180, 42, { width: 373, align: "right" }); doc.font("Helvetica").fontSize(8.5).fillColor(gray).text(`Periodo: ${filters.period}  ·  Generado ${new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" }).format(new Date())}`, 180, 67, { width: 373, align: "right" }); doc.moveTo(42, 88).lineTo(553, 88).strokeColor(red).lineWidth(2).stroke();
  const heading = (value: string, y: number) => { doc.font("Helvetica-Bold").fontSize(10).fillColor(red).text(value.toUpperCase(), 42, y); doc.moveTo(42, y + 17).lineTo(553, y + 17).strokeColor(line).stroke(); };
  const statusRows = summaryResult.rows.map(item => [statusLabels[item.status] || item.status, String(item.count)]); const totalTickets = statusRows.reduce((total, row) => total + Number(row[1]), 0); const activeTickets = summaryResult.rows.filter(item => !["resolved", "closed"].includes(item.status)).reduce((total, item) => total + item.count, 0);
  heading("Resumen de tickets", 120); doc.roundedRect(42, 146, 511, 70, 7).fillAndStroke(pale, line); [["Total", totalTickets], ["En atención", activeTickets], ["Cerrados", summaryResult.rows.filter(item => item.status === "closed").reduce((total, item) => total + item.count, 0)]].forEach(([label, count], index) => { doc.font("Helvetica-Bold").fontSize(8).fillColor(gray).text(String(label).toUpperCase(), 58 + index * 165, 162); doc.font("Helvetica-Bold").fontSize(19).fillColor(navy).text(String(count), 58 + index * 165, 178); });
  heading("Tickets por estado", 250); let y = 280; for (const row of statusRows) { doc.font("Helvetica").fontSize(9).fillColor(navy).text(row[0], 58, y); doc.font("Helvetica-Bold").text(row[1], 470, y, { width: 55, align: "right" }); doc.moveTo(58, y + 16).lineTo(525, y + 16).strokeColor(line).stroke(); y += 25; }
  heading("Detalle de tickets registrados", y + 22); y += 52; doc.font("Helvetica-Bold").fontSize(7.5).fillColor(gray).text("NÚMERO DE TICKET", 58, y, { width: 62, ellipsis: true }); doc.text("DESCRIPCIÓN / ACTIVO", 125, y, { width: 250, ellipsis: true }); doc.text("ESTADO OPERATIVO", 385, y, { width: 75, ellipsis: true }); doc.text("FECHA DE REGISTRO", 465, y, { width: 60, ellipsis: true }); y += 20;
  const ticketStatusLabels: Record<string, string> = { open: "Abierto", in_progress: "En proceso", pending_customer: "Pend. cliente", pending_parts: "Pend. repuesto", resolved: "Resuelto", closed: "Cerrado" };
  for (const ticket of ticketDetailResult.rows) { if (y > 735) { doc.addPage(); y = 50; heading("Detalle de tickets (continuación)", y); y += 30; doc.font("Helvetica-Bold").fontSize(7.5).fillColor(gray).text("NÚMERO DE TICKET", 58, y, { width: 62, ellipsis: true }); doc.text("DESCRIPCIÓN / ACTIVO", 125, y, { width: 250, ellipsis: true }); doc.text("ESTADO OPERATIVO", 385, y, { width: 75, ellipsis: true }); doc.text("FECHA DE REGISTRO", 465, y, { width: 60, ellipsis: true }); y += 20; } doc.font("Helvetica-Bold").fontSize(8).fillColor(navy).text(`TK-${String(ticket.ticket_number).padStart(5, "0")}`, 58, y); doc.font("Helvetica").text(`${ticket.subject || "Sin asunto"}${ticket.asset_tag ? ` · ${ticket.asset_tag}` : ticket.asset_name ? ` · ${ticket.asset_name}` : ""}`, 125, y, { width: 250, ellipsis: true }); doc.text(ticketStatusLabels[ticket.status] || ticket.status, 385, y, { width: 75, ellipsis: true }); doc.text(priorityLabels[ticket.priority] || ticket.priority || "-", 385, y + 11, { width: 75, ellipsis: true }); doc.text(ticket.created_at ? new Intl.DateTimeFormat("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(ticket.created_at)) : "-", 465, y, { width: 60 }); doc.moveTo(58, y + 15).lineTo(525, y + 15).strokeColor(line).stroke(); y += 24; }
  if (y > 690) { doc.addPage(); y = 50; } heading("Activos por incidencia", y + 22); y += 52; const assetCounts = [["Todos", assetResult.rows.length], ["Con incidencias activas", assetResult.rows.filter(item => item.active_incidents > 0).length], ["Con incidencias cerradas", assetResult.rows.filter(item => item.incident_count > 0 && item.active_incidents === 0).length], ["Sin incidencias", assetResult.rows.filter(item => item.incident_count === 0).length]]; for (const row of assetCounts) { doc.font("Helvetica").fontSize(9).fillColor(navy).text(String(row[0]), 58, y); doc.font("Helvetica-Bold").text(String(row[1]), 470, y, { width: 55, align: "right" }); y += 25; }
  heading("Detalle de equipos registrados", y + 12); y += 42; doc.font("Helvetica-Bold").fontSize(7.5).fillColor(gray).text("CÓDIGO DEL EQUIPO", 58, y, { width: 92, ellipsis: true }); doc.text("DESCRIPCIÓN DEL EQUIPO", 160, y, { width: 215, ellipsis: true }); doc.text("INCIDENCIAS REGISTRADAS", 390, y, { width: 75, ellipsis: true }); doc.text("INCIDENCIAS ACTIVAS", 470, y, { width: 55, ellipsis: true }); y += 20;
  for (const asset of assetItems) { if (y > 735) { doc.addPage(); y = 50; } doc.font("Helvetica").fontSize(8.5).fillColor(navy).text(asset.asset_tag || "-", 58, y); doc.text([asset.brand, asset.model].filter(Boolean).join(" ") || asset.asset_type || "Equipo", 160, y, { width: 215, ellipsis: true }); doc.text(String(asset.incident_count), 390, y); doc.text(String(asset.active_incidents), 470, y); doc.moveTo(58, y + 15).lineTo(525, y + 15).strokeColor(line).stroke(); y += 24; }
  doc.font("Helvetica").fontSize(8).fillColor(gray).text("Documento generado por HardSystem  ·  Estadística operativa confidencial", 42, 770, { width: 511, align: "center" }); doc.end(); const buffer = await complete; reply.header("Content-Type", "application/pdf").header("Content-Disposition", `attachment; filename="estadisticas-operativas-${filters.period}.pdf"`); return reply.send(buffer);
});

app.get("/api/reports/collection/:type.pdf", { preHandler: auth }, async (request, reply) => {
  const { type } = z.object({ type: z.enum(["assets", "orders", "contacts"]) }).parse(request.params);
  const isClient = request.user.role === "client";
  const scopeValue = isClient ? request.user.sub : request.user.organizationId;
  const scope = isClient ? (type === "assets" ? " WHERE a.owner_user_id=$1" : " WHERE organization_id=$1") : "";
  const params = isClient ? [scopeValue] : [];
  const definitions = {
    assets: { title: "Reporte de equipos", headers: ["Código", "Equipo", "Propietario", "Serie", "Estado", "Ubicación"] },
    orders: { title: "Reporte de compras", headers: ["Orden", "Estado", "Fecha", "Total", "Notas"] },
    contacts: { title: "Reporte de contactos", headers: ["Nombre", "Cargo", "Correo", "Teléfono", "Principal"] },
  } as const;
  let result;
  if (type === "assets") result = await pool.query(`SELECT a.asset_tag,a.asset_type,a.brand,a.model,u.full_name owner_name,a.serial_number,a.status,a.location FROM assets a LEFT JOIN users u ON u.id=a.owner_user_id${scope} ORDER BY a.asset_tag`, params);
  else if (type === "orders") result = await pool.query(`SELECT order_number,status,purchased_at,total_cop,notes FROM orders${scope} ORDER BY created_at DESC`, params);
  else result = await pool.query(`SELECT full_name,position,email,phone,is_primary FROM contacts${scope} ORDER BY full_name`, params);
  const definition = definitions[type];
  const rows = result.rows.map(item => type === "assets"
    ? [item.asset_tag, [item.brand, item.model].filter(Boolean).join(" ") || item.asset_type, item.owner_name || "Sin asignar", item.serial_number || "-", item.status, item.location || "-"]
    : type === "orders"
      ? [`OC-${item.order_number}`, item.status, item.purchased_at ? new Intl.DateTimeFormat("es-CO", { dateStyle: "medium" }).format(new Date(item.purchased_at)) : "-", new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(Number(item.total_cop || 0)), item.notes || "-"]
      : [item.full_name, item.position || "-", item.email || "-", item.phone || "-", item.is_primary ? "Sí" : "No"]);
  const doc = new PDFDocument({ size: "A4", margin: 42, info: { Title: `${definition.title} - HardSystem`, Author: "HardSystem" } });
  const chunks: Buffer[] = [];
  doc.on("data", chunk => chunks.push(chunk));
  const complete = new Promise<Buffer>((resolveDocument, reject) => { doc.on("end", () => resolveDocument(Buffer.concat(chunks))); doc.on("error", reject); });
  const navy = "#16232f"; const red = "#c71920"; const gray = "#687681"; const line = "#dfe5e8"; const pale = "#f5f7f8";
  const logoPath = resolve(process.cwd(), "Logo/logoHS01.png");
  const drawHeader = () => { try { doc.image(logoPath, 42, 34, { fit: [100, 32] }); } catch { doc.font("Helvetica-Bold").fontSize(14).fillColor(navy).text("HardSystem", 42, 43); } doc.font("Helvetica-Bold").fontSize(18).fillColor(navy).text(definition.title.toUpperCase(), 190, 42, { width: 363, align: "right" }); doc.font("Helvetica").fontSize(8.5).fillColor(gray).text(`Generado ${new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" }).format(new Date())}  ·  ${rows.length} registros autorizados`, 190, 68, { width: 363, align: "right" }); doc.moveTo(42, 88).lineTo(553, 88).strokeColor(red).lineWidth(2).stroke(); };
  const drawTableHeader = (y: number) => { const widths = type === "assets" ? [70, 135, 115, 82, 64, 45] : type === "orders" ? [75, 78, 86, 90, 182] : [125, 85, 145, 91, 40]; let x = 42; doc.rect(42, y - 5, 511, 24).fill(pale); definition.headers.forEach((header, index) => { const cellWidth = widths[index]!; doc.font("Helvetica-Bold").fontSize(7.5).fillColor(gray).text(header.toUpperCase(), x + 6, y + 3, { width: cellWidth - 12 }); x += cellWidth; }); return widths; };
  const drawTableRow = (row: unknown[], y: number, widths: number[]) => { const heights = row.map((value, index) => { const cellWidth = widths[index]!; doc.font("Helvetica").fontSize(8.5); return doc.heightOfString(String(value ?? "-"), { width: cellWidth - 12 }); }); const height = Math.max(28, Math.min(58, Math.max(...heights) + 14)); if (Math.round(y / 28) % 2 === 0) doc.rect(42, y - 5, 511, height).fill("#fbfcfc"); let x = 42; row.forEach((value, index) => { const cellWidth = widths[index]!; doc.font("Helvetica").fontSize(8.5).fillColor(navy).text(String(value ?? "-"), x + 6, y + 3, { width: cellWidth - 12, height: height - 8, ellipsis: true }); x += cellWidth; }); doc.moveTo(42, y + height - 5).lineTo(553, y + height - 5).strokeColor(line).lineWidth(.5).stroke(); return height; };
  drawHeader();
  let y = 122; let widths = drawTableHeader(y); y += 24;
  for (const row of rows) { doc.font("Helvetica").fontSize(8.5); const estimated = Math.max(28, Math.min(58, Math.max(...row.map((value, index) => doc.heightOfString(String(value ?? "-"), { width: widths[index]! - 12 }))) + 14)); if (y + estimated > 750) { doc.addPage(); drawHeader(); y = 122; widths = drawTableHeader(y); y += 24; } y += drawTableRow(row, y, widths); }
  doc.font("Helvetica").fontSize(8).fillColor(gray).text("Documento generado por HardSystem  ·  Registro operativo confidencial", 42, 770, { width: 511, align: "center" });
  doc.end();
  const buffer = await complete;
  reply.header("Content-Type", "application/pdf").header("Content-Disposition", `attachment; filename="reporte-${type}.pdf"`);
  return reply.send(buffer);
});

app.get("/api/reports/collection/:type/:id.pdf", { preHandler: auth }, async (request, reply) => {
  const { type, id } = z.object({ type: z.enum(["assets", "orders", "contacts"]), id: z.string().uuid() }).parse(request.params);
  const isClient = request.user.role === "client";
  const scopeValue = isClient ? request.user.sub : request.user.organizationId;
  const record = type === "assets"
    ? (await pool.query(`SELECT a.*,u.full_name owner_name,u.email owner_email,o.name organization_name FROM assets a LEFT JOIN users u ON u.id=a.owner_user_id LEFT JOIN organizations o ON o.id=a.organization_id WHERE a.id=$1${isClient ? " AND a.owner_user_id=$2" : ""}`, isClient ? [id, scopeValue] : [id])).rows[0]
    : type === "orders"
      ? (await pool.query(`SELECT o.*,org.name organization_name FROM orders o LEFT JOIN organizations org ON org.id=o.organization_id WHERE o.id=$1${isClient ? " AND o.organization_id=$2" : ""}`, isClient ? [id, scopeValue] : [id])).rows[0]
      : (await pool.query(`SELECT c.*,org.name organization_name FROM contacts c LEFT JOIN organizations org ON org.id=c.organization_id WHERE c.id=$1${isClient ? " AND c.organization_id=$2" : ""}`, isClient ? [id, scopeValue] : [id])).rows[0];
  if (!record) return reply.code(404).send({ error: "Registro no encontrado" });
  const incidents = type === "assets" ? (await pool.query(`SELECT t.ticket_number,t.subject,t.status,t.priority,t.category,t.description,t.closure_note,t.created_at,t.updated_at,t.closed_at,assigned.full_name assigned_name FROM tickets t LEFT JOIN users assigned ON assigned.id=t.assigned_to WHERE t.asset_id=$1 ORDER BY t.created_at DESC`, [id])).rows : [];
  const doc = new PDFDocument({ size: "A4", margin: 42, info: { Title: `Expediente ${type} - HardSystem`, Author: "HardSystem" } });
  const chunks: Buffer[] = []; doc.on("data", chunk => chunks.push(chunk));
  const complete = new Promise<Buffer>((resolveDocument, reject) => { doc.on("end", () => resolveDocument(Buffer.concat(chunks))); doc.on("error", reject); });
  const navy = "#16232f"; const red = "#c71920"; const gray = "#687681"; const line = "#dfe5e8"; const pale = "#f5f7f8"; const green = "#177245";
  const formatDate = (value: unknown, withTime = true) => value ? new Intl.DateTimeFormat("es-CO", withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" }).format(new Date(String(value))) : "-";
  const statusLabels = { open: "Abierto", in_progress: "En diagnóstico", pending_customer: "Pendiente cliente", pending_parts: "Pendiente repuesto", resolved: "Resuelto", closed: "Cerrado", confirmed: "Confirmada", received: "Recibida", cancelled: "Cancelada" } as Record<string, string>;
  const logoPath = resolve(process.cwd(), "Logo/logoHS01.png");
  const title = type === "assets" ? "EXPEDIENTE DE ACTIVO" : type === "orders" ? "EXPEDIENTE DE COMPRA" : "EXPEDIENTE DE CONTACTO";
  const label = type === "assets" ? `Activo ${record.asset_tag || "sin código"}` : type === "orders" ? `Orden OC-${record.order_number}` : record.full_name;
  const header = (subtitle = "Ficha individual") => { try { doc.image(logoPath, 42, 34, { fit: [105, 34] }); } catch { doc.font("Helvetica-Bold").fontSize(15).fillColor(navy).text("HardSystem", 42, 43); } doc.font("Helvetica-Bold").fontSize(17).fillColor(navy).text(title, 180, 41, { width: 373, align: "right" }); doc.font("Helvetica").fontSize(8.5).fillColor(gray).text(`${subtitle}  ·  Generado ${formatDate(new Date())}`, 180, 66, { width: 373, align: "right" }); doc.moveTo(42, 88).lineTo(553, 88).strokeColor(red).lineWidth(2).stroke(); };
  const section = (heading: string, y: number) => { doc.font("Helvetica-Bold").fontSize(10).fillColor(red).text(heading.toUpperCase(), 42, y, { width: 511 }); doc.moveTo(42, y + 17).lineTo(553, y + 17).strokeColor(line).stroke(); };
  const field = (name: string, value: unknown, x: number, y: number, width: number) => { doc.font("Helvetica-Bold").fontSize(7.5).fillColor(gray).text(name.toUpperCase(), x, y, { width }); doc.font("Helvetica").fontSize(9.5).fillColor(navy).text(String(value || "-"), x, y + 11, { width, height: 31, ellipsis: true }); };
  const card = (x: number, y: number, width: number, fields: Array<[string, unknown]>) => { const columns = width > 300 ? 3 : 2; const rowCount = Math.ceil(fields.length / columns); const height = 28 + rowCount * 48; doc.roundedRect(x, y, width, height, 7).fillAndStroke(pale, line); const cellWidth = (width - 32) / columns; fields.forEach(([name, value], index) => field(name, value, x + 16 + index % columns * cellWidth, y + 14 + Math.floor(index / columns) * 48, cellWidth - 10)); return height; };
  header(); doc.font("Helvetica-Bold").fontSize(18).fillColor(navy).text(label, 42, 116, { width: 511 });
  if (type === "assets") {
    doc.font("Helvetica").fontSize(9).fillColor(gray).text(`${record.asset_type || "Equipo"}  ·  ${record.status || "-"}  ·  ${incidents.length} incidencia${incidents.length === 1 ? "" : "s"} registrada${incidents.length === 1 ? "" : "s"}`, 42, 143);
    section("Identificación y custodia", 178);
    const assetCardHeight = card(42, 200, 511, [["Código patrimonial", record.asset_tag], ["Tipo", record.asset_type], ["Marca", record.brand], ["Modelo", record.model], ["Número de serie", record.serial_number], ["Estado", statusLabels[record.status] || record.status], ["Propietario", record.owner_name], ["Correo propietario", record.owner_email], ["Empresa", record.organization_name], ["Ubicación", record.location]]);
    section("Historial de incidencias", 200 + assetCardHeight + 34);
    let y = 200 + assetCardHeight + 64;
    if (!incidents.length) doc.font("Helvetica").fontSize(9).fillColor(gray).text("No hay incidencias asociadas a este activo.", 42, y);
    for (const incident of incidents) {
      doc.roundedRect(42, y, 511, 93, 7).fillAndStroke(incident.status === "closed" ? "#f5faf7" : "#fff8f7", line);
      doc.font("Helvetica-Bold").fontSize(10).fillColor(navy).text(`TK-${String(incident.ticket_number).padStart(5, "0")}  ·  ${incident.subject}`, 56, y + 13, { width: 370 });
      doc.font("Helvetica-Bold").fontSize(8).fillColor(incident.status === "closed" ? green : red).text(statusLabels[incident.status] || incident.status, 430, y + 15, { width: 103, align: "right" });
      doc.font("Helvetica").fontSize(8).fillColor(gray).text(`${formatDate(incident.created_at, false)}  ·  ${incident.category || "Soporte"}  ·  Prioridad ${incident.priority || "-"}  ·  Técnico: ${incident.assigned_name || "Sin asignar"}`, 56, y + 34, { width: 483 });
      doc.font("Helvetica").fontSize(8.5).fillColor(navy).text(incident.closure_note || incident.description || "Sin detalle documentado.", 56, y + 52, { width: 483, height: 30, ellipsis: true }); y += 105;
      if (y > 720) { doc.addPage(); header("Continuación del historial"); y = 116; }
    }
  } else if (type === "orders") {
    doc.font("Helvetica").fontSize(9).fillColor(gray).text(`${statusLabels[record.status] || record.status || "Sin estado"}  ·  ${record.organization_name || "Sin empresa"}`, 42, 143);
    section("Detalle de la orden", 178);
    const orderCardHeight = card(42, 200, 511, [["Número de orden", `OC-${record.order_number}`], ["Empresa", record.organization_name], ["Estado", statusLabels[record.status] || record.status], ["Fecha de compra", formatDate(record.purchased_at, false)], ["Total", new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(Number(record.total_cop || 0))], ["Creada", formatDate(record.created_at)], ["Última actualización", formatDate(record.updated_at)]]);
    const notesY = 200 + orderCardHeight + 34; section("Notas y observaciones", notesY); doc.roundedRect(42, notesY + 30, 511, 100, 7).fillAndStroke(pale, line); doc.font("Helvetica").fontSize(10).fillColor(navy).text(record.notes || "No hay notas registradas para esta orden.", 58, notesY + 50, { width: 479, lineGap: 3 });
  } else {
    doc.font("Helvetica").fontSize(9).fillColor(gray).text(`${record.position || "Contacto operativo"}  ·  ${record.organization_name || "Sin empresa"}`, 42, 143);
    section("Datos de contacto", 178);
    const contactCardHeight = card(42, 200, 511, [["Nombre completo", record.full_name], ["Cargo", record.position], ["Empresa", record.organization_name], ["Correo electrónico", record.email], ["Teléfono", record.phone], ["Contacto principal", record.is_primary ? "Sí" : "No"], ["Estado", record.is_active ? "Activo" : "Inactivo"], ["Registrado", formatDate(record.created_at)] ]);
    const infoY = 200 + contactCardHeight + 34; section("Información operativa", infoY); doc.roundedRect(42, infoY + 30, 511, 100, 7).fillAndStroke(pale, line); doc.font("Helvetica").fontSize(10).fillColor(navy).text(record.is_primary ? "Este contacto está marcado como referente principal de su empresa." : "Este contacto está disponible en el directorio operativo de su empresa.", 58, infoY + 50, { width: 479, lineGap: 3 });
  }
  doc.font("Helvetica").fontSize(8).fillColor(gray).text("Documento generado por HardSystem  ·  Expediente operativo confidencial", 42, 770, { width: 511, align: "center" }); doc.end();
  const recordName = type === "assets" ? `equipo-${record.asset_tag || id}` : type === "orders" ? `compra-OC-${record.order_number || id}` : `contacto-${record.full_name || id}`;
  const safeRecordName = recordName.replace(/[^a-z0-9_-]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const buffer = await complete; reply.header("Content-Type", "application/pdf").header("Content-Disposition", `attachment; filename="${safeRecordName}.pdf"`); return reply.send(buffer);
});

app.get("/api/reports/:id.pdf", { preHandler: auth }, async (request, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const filter = ticketScope(request.user, "t", 2);
  const ticketResult = await pool.query(`SELECT t.*,requester.full_name requester_name,requester.email requester_email,requester.phone requester_phone,
      requester.organization_id requester_organization_id,o.name organization_name,assigned.full_name assigned_name,
      a.asset_tag,a.asset_type,a.brand,a.model,a.serial_number,a.status asset_status,a.location,a.owner_user_id
    FROM tickets t JOIN users requester ON requester.id=t.requester_id LEFT JOIN organizations o ON o.id=t.organization_id
    LEFT JOIN users assigned ON assigned.id=t.assigned_to LEFT JOIN assets a ON a.id=t.asset_id
    WHERE t.id=$1${filter.sql}`, [id, ...filter.params]);
  const ticket = ticketResult.rows[0];
  if (!ticket) return reply.code(404).send({ error: "Reporte no encontrado" });
  const [commentsResult, eventsResult, assetEventsResult] = await Promise.all([
    pool.query(`SELECT c.body,c.is_internal,c.created_at,u.full_name author,
        COALESCE(json_agg(json_build_object('name',a.original_name,'storageKey',a.storage_key,'contentType',a.content_type)
          ORDER BY a.created_at) FILTER (WHERE a.id IS NOT NULL),'[]') attachments
      FROM ticket_comments c JOIN users u ON u.id=c.author_id LEFT JOIN attachments a ON a.comment_id=c.id
      WHERE c.ticket_id=$1 AND ($2::boolean=false OR c.is_internal=false)
      GROUP BY c.id,u.full_name ORDER BY c.created_at`, [id, request.user.role === "client"]),
    pool.query("SELECT e.event_type,e.previous_value,e.new_value,e.created_at,u.full_name actor FROM ticket_events e LEFT JOIN users u ON u.id=e.actor_id WHERE e.ticket_id=$1 ORDER BY e.created_at DESC LIMIT 6", [id]),
    ticket.asset_id ? pool.query("SELECT previous_owner_name,new_owner_name,changed_by,changed_at FROM asset_owner_history WHERE asset_id=$1 ORDER BY changed_at DESC LIMIT 3", [ticket.asset_id]) : Promise.resolve({ rows: [] }),
  ]);
  const doc = new PDFDocument({ size: "A4", margin: 42, info: { Title: `Reporte ${ticket.ticket_number} - HardSystem`, Author: "HardSystem" } });
  const chunks: Buffer[] = [];
  doc.on("data", chunk => chunks.push(chunk));
  const complete = new Promise<Buffer>((resolveDocument, reject) => { doc.on("end", () => resolveDocument(Buffer.concat(chunks))); doc.on("error", reject); });
  const navy = "#16232f"; const red = "#c71920"; const gray = "#687681"; const line = "#dfe5e8"; const pale = "#f5f7f8"; const green = "#177245";
  const formatDate = (value: unknown) => value ? new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" }).format(new Date(String(value))) : "-";
  const statusText = ({ open: "Abierto", in_progress: "En diagnóstico", pending_customer: "Pendiente cliente", pending_parts: "Pendiente repuesto", resolved: "Resuelto", closed: "Cerrado" } as Record<string, string>)[ticket.status] || ticket.status;
  const safePhone = ticket.requester_phone && ticket.requester_phone !== ticket.requester_email ? ticket.requester_phone : "";
  const card = (x: number, y: number, width: number, height: number, title: string, rows: Array<[string, string]>, accent = red) => {
    doc.roundedRect(x, y, width, height, 8).fillAndStroke("#ffffff", line);
    doc.rect(x, y, 4, height).fill(accent);
    doc.font("Helvetica-Bold").fontSize(8).fillColor(gray).text(title.toUpperCase(), x + 16, y + 13, { width: width - 28 });
    let rowY = y + 31;
    rows.forEach(([key, value]) => { doc.font("Helvetica-Bold").fontSize(8.5).fillColor(navy).text(`${key}  `, x + 16, rowY, { continued: true, width: width - 28 }); doc.font("Helvetica").fontSize(8.5).fillColor(navy).text(value || "-", { width: width - 28 }); rowY = doc.y + 4; });
  };
  const heading = (title: string, y = doc.y, x = 42, width = 511) => { doc.font("Helvetica-Bold").fontSize(10).fillColor(red).text(title.toUpperCase(), x, y, { width }); doc.moveTo(x, doc.y + 5).lineTo(x + width, doc.y + 5).strokeColor(line).lineWidth(1).stroke(); };
  const textCard = (x: number, y: number, width: number, title: string, value: string, accent = red) => { doc.font("Helvetica").fontSize(9); const height = Math.max(70, 43 + doc.heightOfString(value || "-", { width: width - 32 }) + 8); doc.roundedRect(x, y, width, height, 8).fillAndStroke(pale, line); doc.rect(x, y, width, 4).fill(accent); doc.font("Helvetica-Bold").fontSize(8).fillColor(gray).text(title.toUpperCase(), x + 16, y + 15, { width: width - 32 }); doc.font("Helvetica").fontSize(9).fillColor(navy).text(value || "-", x + 16, y + 31, { width: width - 32, lineGap: 2 }); return height; };
  const timeline = (items: Array<{ date: string; actor: string; body: string }>, x: number, y: number, width: number) => { let cursor = y; items.forEach((item, index) => { if (index) { doc.moveTo(x + 5, cursor - 7).lineTo(x + 5, cursor + 1).strokeColor(line).lineWidth(2).stroke(); } doc.circle(x + 5, cursor + 6, 4).fill(index === 0 ? red : "#fff").strokeColor(index === 0 ? red : line).stroke(); doc.font("Helvetica-Bold").fontSize(7.5).fillColor(gray).text(item.date, x + 18, cursor, { width: width - 18 }); doc.font("Helvetica-Bold").fontSize(8.5).fillColor(navy).text(item.body, x + 18, doc.y + 2, { width: width - 18 }); doc.font("Helvetica").fontSize(8).fillColor(gray).text(item.actor, x + 18, doc.y + 2, { width: width - 18 }); cursor = doc.y + 12; }); };
  const logoPath = resolve(process.cwd(), "Logo/logoHS01.png");
  try { doc.image(logoPath, 42, 38, { fit: [116, 38] }); } catch { doc.font("Helvetica-Bold").fontSize(18).fillColor(navy).text("HardSystem", 42, 48); }
  doc.font("Helvetica-Bold").fontSize(19).fillColor(navy).text("INFORME DE SERVICIO", 300, 43, { width: 253, align: "right" });
  doc.font("Helvetica").fontSize(9).fillColor(gray).text(`Generado ${formatDate(new Date())}`, 300, 68, { width: 253, align: "right" });
  doc.moveTo(42, 96).lineTo(553, 96).strokeColor(red).lineWidth(2).stroke();
  doc.font("Helvetica-Bold").fontSize(17).fillColor(navy).text(`TK-${String(ticket.ticket_number).padStart(5, "0")}`, 42, 116); doc.font("Helvetica").fontSize(9).fillColor(gray).text(`${ticket.category || "support"}  /  Prioridad ${ticket.priority}  /  ${statusText}`, 42, 139);
  doc.roundedRect(445, 116, 108, 30, 15).fill(ticket.status === "closed" ? green : red); doc.font("Helvetica-Bold").fontSize(9).fillColor("#fff").text(statusText.toUpperCase(), 445, 127, { width: 108, align: "center" });
  doc.font("Helvetica-Bold").fontSize(14).fillColor(navy).text(ticket.subject, 42, 164, { width: 511 });
  heading("Ficha operativa", 204);
  card(42, 226, 247, 92, "Solicitante", [["Nombre", ticket.requester_name], ["Correo", ticket.requester_email], ...(safePhone ? [["Teléfono", safePhone] as [string, string]] : [])]);
  card(306, 226, 247, 92, "Responsables", [["Empresa", ticket.organization_name || "Cliente estándar"], ["Técnico", ticket.assigned_name || "Sin asignar"], ["Cierre", formatDate(ticket.closed_at || ticket.updated_at)]]);
  heading("Equipo afectado", 344);
  if (ticket.asset_id) card(42, 366, 511, 76, "Activo registrado", [["Activo", `${ticket.asset_tag || "-"}  ·  ${[ticket.brand, ticket.model].filter(Boolean).join(" ") || ticket.asset_type || "Equipo"}`], ["Serie / estado", `${ticket.serial_number || "Sin serie"}  ·  ${ticket.asset_status || "-"}`], ["Propietario / ubicación", `${ticket.requester_name}  ·  ${ticket.location || "Sin ubicación"}`]], "#3b7185"); else textCard(42, 366, 511, "Equipo afectado", "La solicitud no tiene un equipo asociado.", "#3b7185");
  heading("Diagnóstico y resolución", 468);
  const descriptionHeight = textCard(42, 490, 247, "Descripción reportada", ticket.description, "#3b7185");
  const solution = ticket.closure_note || "El caso continúa en seguimiento; aún no se ha registrado una solución final.";
  const solutionHeight = textCard(306, 490, 247, ticket.status === "closed" ? "Solución aplicada" : "Situación actual", solution, ticket.status === "closed" ? green : red);
  const detailBottom = 490 + Math.max(descriptionHeight, solutionHeight);
  if (ticket.status === "closed") { doc.font("Helvetica-Bold").fontSize(8).fillColor(gray).text("CAUSA DE CIERRE", 42, detailBottom + 16); doc.font("Helvetica").fontSize(9).fillColor(navy).text(closureCauseLabels[ticket.closure_cause as keyof typeof closureCauseLabels] || ticket.closure_cause || "-", 42, detailBottom + 29); }
  doc.addPage();
  try { doc.image(logoPath, 42, 34, { fit: [94, 30] }); } catch { doc.font("Helvetica-Bold").fontSize(14).fillColor(navy).text("HardSystem", 42, 43); }
  doc.font("Helvetica-Bold").fontSize(12).fillColor(navy).text(`TK-${String(ticket.ticket_number).padStart(5, "0")}  /  Historial operativo`, 170, 42, { width: 383, align: "right" });
  doc.moveTo(42, 78).lineTo(553, 78).strokeColor(line).stroke();
  heading("Conversación y evidencias", 102);
  let commentY = 130;
  if (commentsResult.rows.length) for (const comment of commentsResult.rows) {
    doc.font("Helvetica").fontSize(9);
    const attachments = (comment.attachments || []) as Array<{ name: string; storageKey: string; contentType: string }>;
    const imageAttachments: Array<{ name: string; buffer: Buffer }> = [];
    for (const attachment of attachments) {
      if (attachment.contentType === "image/jpeg" || attachment.contentType === "image/png") {
        try {
          const original = await readFile(resolve(config.ATTACHMENTS_PATH, attachment.storageKey));
          const thumbnail = await sharp(original).rotate().resize({ width: 900, height: 650, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 68, mozjpeg: true }).toBuffer();
          imageAttachments.push({ name: attachment.name, buffer: thumbnail });
        } catch { /* Evidence may have been removed or cannot be decoded. */ }
      }
    }
    const evidenceHeight = imageAttachments.length ? 24 + Math.ceil(imageAttachments.length / 3) * 98 : attachments.length ? 20 : 0;
    const bodyHeight = Math.max(35, doc.heightOfString(comment.body, { width: 483 }) + 22 + evidenceHeight);
    doc.roundedRect(42, commentY, 511, bodyHeight).fillAndStroke(comment.is_internal ? "#fff8e8" : pale, line);
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(navy).text(`${comment.author}  ·  ${formatDate(comment.created_at)}${comment.is_internal ? "  ·  Nota interna" : ""}`, 56, commentY + 9, { width: 483 });
    doc.font("Helvetica").fontSize(9).fillColor(navy).text(comment.body, 56, commentY + 23, { width: 483, lineGap: 2 });
    if (attachments.length) {
      const evidenceY = commentY + 23 + doc.heightOfString(comment.body, { width: 483 }) + 8;
      doc.font("Helvetica-Bold").fontSize(7.5).fillColor(gray).text(`EVIDENCIA ADJUNTA  ·  ${attachments.length} archivo${attachments.length === 1 ? "" : "s"}`, 56, evidenceY, { width: 483 });
      imageAttachments.forEach((attachment, index) => { try { doc.image(attachment.buffer, 56 + (index % 3) * 164, evidenceY + 13, { fit: [150, 92], align: "center", valign: "center" }); } catch { /* Keep the report readable if an image cannot be decoded. */ } });
      if (!imageAttachments.length) doc.font("Helvetica").fontSize(8).fillColor(gray).text(attachments.map(attachment => attachment.name).join("  ·  "), 56, evidenceY + 14, { width: 483 });
    }
    commentY += bodyHeight + 9;
  } else doc.font("Helvetica").fontSize(9).fillColor(gray).text("Sin comentarios registrados.", 42, commentY);
  doc.addPage();
  try { doc.image(logoPath, 42, 34, { fit: [94, 30] }); } catch { doc.font("Helvetica-Bold").fontSize(14).fillColor(navy).text("HardSystem", 42, 43); }
  doc.font("Helvetica-Bold").fontSize(12).fillColor(navy).text(`TK-${String(ticket.ticket_number).padStart(5, "0")}  /  Auditoría y activos`, 170, 42, { width: 383, align: "right" });
  doc.moveTo(42, 78).lineTo(553, 78).strokeColor(line).stroke();
  const historyY = 104;
  const historyColumnWidth = ticket.asset_id ? 270 : 511;
  heading("Trazabilidad", historyY, 42, historyColumnWidth);
  const eventItems = eventsResult.rows.map(event => ({ date: formatDate(event.created_at), actor: event.actor || "Sistema", body: event.event_type === "created" ? "Ticket creado" : event.event_type === "closed" ? "Ticket cerrado con soporte" : event.event_type === "reopened" ? "Ticket reabierto con soporte" : "Ticket actualizado" }));
  timeline(eventItems, 42, historyY + 28, historyColumnWidth);
  if (ticket.asset_id) { heading("Últimos 3 eventos del activo", historyY, 330, 223); timeline(assetEventsResult.rows.map(event => ({ date: formatDate(event.changed_at), actor: "Historial de propiedad", body: `${event.previous_owner_name || "Sin asignar"}  ->  ${event.new_owner_name}` })), 330, historyY + 28, 223); }
  doc.font("Helvetica").fontSize(8).fillColor(gray).text("Documento generado por HardSystem  ·  Registro operativo confidencial", 42, 770, { width: 511, align: "center" });
  doc.end();
  const buffer = await complete;
  reply.header("Content-Type", "application/pdf").header("Content-Disposition", `attachment; filename="reporte-TK-${String(ticket.ticket_number).padStart(5, "0")}.pdf"`);
  return reply.send(buffer);
});

app.get("/api/assets", { preHandler: auth }, async (request) => {
  const scope = organizationScope(request.user, "a");
  const ownerFilter = request.user.role === "client" ? ` AND a.owner_user_id=$${scope.params.length + 1}` : "";
  const params = request.user.role === "client" ? [...scope.params, request.user.sub] : scope.params;
  const result = await pool.query(`SELECT a.*,u.full_name owner_name,u.email owner_email
    FROM assets a LEFT JOIN users u ON u.id=a.owner_user_id WHERE 1=1${scope.sql}${ownerFilter} ORDER BY a.asset_tag`, params);
  return { items: result.rows };
});

for (const [path, table, order] of [["orders", "orders", "created_at"], ["contacts", "contacts", "full_name"]] as const) {
  app.get(`/api/${path}`, { preHandler: auth }, async (request) => {
    const scope = organizationScope(request.user, table);
    return { items: (await pool.query(`SELECT * FROM ${table} WHERE 1=1${scope.sql} ORDER BY ${order}`, scope.params)).rows };
  });
}
app.get("/api/operators", { preHandler: staff }, async (request) => { const scope = organizationScope(request.user, "u", 1); return { items: (await pool.query(`SELECT u.id,u.full_name FROM users u WHERE u.role IN ('agent','supervisor','admin') AND u.account_status='active'${scope.sql} ORDER BY u.full_name`, scope.params)).rows }; });

app.get("/api/organizations", { preHandler: staff }, async (request) => { const scope = organizationScope(request.user, "o", 1, "id"); return { items: (await pool.query(`SELECT o.id,o.name,o.email,o.phone,o.city,o.is_active,o.organization_type FROM organizations o WHERE 1=1${scope.sql} ORDER BY o.name`, scope.params)).rows }; });
app.get("/api/ticket-clients", { preHandler: staff }, async (request) => { const scope = organizationScope(request.user, "u", 1); return { items: (await pool.query(`SELECT u.id,u.full_name,u.email,u.phone,u.organization_id,o.name organization_name FROM users u LEFT JOIN organizations o ON o.id=u.organization_id WHERE u.role='client' AND u.account_status='active'${scope.sql} ORDER BY u.full_name`, scope.params)).rows }; });
app.get("/api/users", { preHandler: admin }, async () => ({ items: (await pool.query(`SELECT u.id,u.organization_id,u.email,u.full_name,u.phone,u.role,u.account_status,u.suspended_until,u.status_reason,
  u.last_login_at,u.created_at,o.name organization_name,changer.full_name status_changed_by_name
  FROM users u LEFT JOIN organizations o ON o.id=u.organization_id LEFT JOIN users changer ON changer.id=u.status_changed_by ORDER BY u.full_name`)).rows }));
app.post("/api/organizations", { preHandler: admin }, async (request, reply) => {
  const body = z.object({ name: z.string().min(2).max(160), taxId: z.string().max(40).nullable().optional(), email: z.string().email().nullable().optional(), phone: z.string().max(40).nullable().optional(), address: z.string().max(240).nullable().optional(), city: z.string().min(2).max(100).default("Barranquilla") }).parse(request.body);
  const result = await pool.query("INSERT INTO organizations(name,tax_id,email,phone,address,city) VALUES($1,$2,$3,$4,$5,$6) RETURNING *", [body.name, body.taxId ?? null, body.email ?? null, body.phone ?? null, body.address ?? null, body.city]);
  return reply.code(201).send(result.rows[0]);
});
app.patch("/api/organizations/:id", { preHandler: admin }, async (request, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const body = z.object({ name: z.string().min(2).max(160), taxId: z.string().max(40).nullable().optional(), email: z.string().email().nullable().optional(), phone: z.string().max(40).nullable().optional(), address: z.string().max(240).nullable().optional(), city: z.string().min(2).max(100), isActive: z.boolean() }).parse(request.body);
  const before = (await pool.query("SELECT * FROM organizations WHERE id=$1", [id])).rows[0];
  if (!before) return reply.code(404).send({ error: "Empresa no encontrada" });
  if (body.taxId && (await pool.query("SELECT 1 FROM organizations WHERE tax_id=$1 AND id<>$2", [body.taxId, id])).rowCount) return reply.code(409).send({ error: "El NIT ya está registrado" });
  const result = await pool.query("UPDATE organizations SET name=$2,tax_id=$3,email=$4,phone=$5,address=$6,city=$7,is_active=$8,updated_at=now() WHERE id=$1 RETURNING *", [id, body.name, body.taxId ?? null, body.email ?? null, body.phone ?? null, body.address ?? null, body.city, body.isActive]);
  await pool.query("INSERT INTO audit_logs(actor_id,organization_id,action,entity_type,entity_id,metadata) VALUES($1,$2,'organization.updated','organization',$3,$4)", [request.user.sub, id, id, { before, after: result.rows[0] }]);
  return result.rows[0];
});
app.delete("/api/organizations/:id", { preHandler: admin }, async (request, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const counts = (await pool.query(`SELECT
    (SELECT count(*) FROM users WHERE organization_id=$1) users,
    (SELECT count(*) FROM assets WHERE organization_id=$1) assets,
    (SELECT count(*) FROM contacts WHERE organization_id=$1) contacts,
    (SELECT count(*) FROM orders WHERE organization_id=$1) orders,
    (SELECT count(*) FROM tickets WHERE organization_id=$1) tickets`, [id])).rows[0];
  const usedBy = Object.entries(counts).filter(([, count]) => Number(count) > 0).map(([table, count]) => `${table}: ${count}`).join(", ");
  if (usedBy) return reply.code(409).send({ error: `No se puede eliminar la empresa porque tiene registros relacionados (${usedBy}). Puede desactivarla.` });
  const result = await pool.query("DELETE FROM organizations WHERE id=$1 RETURNING *", [id]);
  if (!result.rowCount) return reply.code(404).send({ error: "Empresa no encontrada" });
  await pool.query("INSERT INTO audit_logs(actor_id,organization_id,action,entity_type,entity_id,metadata) VALUES($1,NULL,'organization.deleted','organization',$2,$3)", [request.user.sub, id, { deleted: result.rows[0] }]);
  return { deleted: true };
});
app.post("/api/users", { preHandler: admin }, async (request, reply) => {
  const body = z.object({ organizationId: z.string().uuid(), email: z.string().email(), fullName: z.string().min(2).max(160), phone: z.string().max(40).nullable().optional(), password: z.string().min(12).max(200), role: z.enum(["client", "agent", "supervisor", "admin"]) }).parse(request.body);
  if ((await pool.query("SELECT 1 FROM users WHERE email=lower($1)", [body.email])).rowCount) return reply.code(409).send({ error: "El correo ya está registrado" });
  const passwordHash = await argon2.hash(body.password, { type: argon2.argon2id });
  const result = await pool.query("INSERT INTO users(organization_id,email,password_hash,full_name,phone,role) VALUES($1,lower($2),$3,$4,$5,$6) RETURNING id,organization_id,email,full_name,phone,role,account_status,created_at", [body.organizationId, body.email, passwordHash, body.fullName, body.phone ?? null, body.role]);
  await pool.query("INSERT INTO audit_logs(actor_id,organization_id,action,entity_type,entity_id,metadata) VALUES($1,$2,'user.created','user',$3,$4)", [request.user.sub, body.organizationId, result.rows[0].id, { email: body.email, role: body.role }]);
  return reply.code(201).send(result.rows[0]);
});
app.patch("/api/users/:id", { preHandler: admin }, async (request, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const body = z.object({ organizationId: z.string().uuid(), email: z.string().email(), fullName: z.string().min(2).max(160), phone: z.string().max(40).nullable().optional(), role: z.enum(["client", "agent", "supervisor", "admin"]), password: z.string().min(12).max(200).optional() }).parse(request.body);
  const before = (await pool.query("SELECT organization_id,email,full_name,phone,role,account_status FROM users WHERE id=$1", [id])).rows[0];
  if (!before) return reply.code(404).send({ error: "Usuario no encontrado" });
  if (id === request.user.sub && body.role !== "admin") return reply.code(400).send({ error: "No puede retirar su propio rol de administrador" });
  if ((await pool.query("SELECT 1 FROM users WHERE email=lower($1) AND id<>$2", [body.email, id])).rowCount) return reply.code(409).send({ error: "El correo ya está registrado" });
  if (before.role === "admin" && body.role !== "admin" && Number((await pool.query("SELECT count(*) total FROM users WHERE role='admin' AND account_status='active' AND id<>$1", [id])).rows[0].total) === 0) return reply.code(400).send({ error: "Debe permanecer al menos un administrador activo" });
  const passwordHash = body.password ? await argon2.hash(body.password, { type: argon2.argon2id }) : null;
  const result = await pool.query(`UPDATE users SET organization_id=$2,email=lower($3),full_name=$4,phone=$5,role=$6,
    password_hash=COALESCE($7,password_hash),updated_at=now() WHERE id=$1 RETURNING id,organization_id,email,full_name,phone,role,account_status`,
    [id, body.organizationId, body.email, body.fullName, body.phone ?? null, body.role, passwordHash]);
  if (body.password) await pool.query("DELETE FROM refresh_sessions WHERE user_id=$1", [id]);
  await pool.query("INSERT INTO audit_logs(actor_id,organization_id,action,entity_type,entity_id,metadata) VALUES($1,$2,'user.updated','user',$3,$4)", [request.user.sub, body.organizationId, id, { before, after: { email: body.email, fullName: body.fullName, phone: body.phone, role: body.role }, passwordChanged: Boolean(body.password) }]);
  return result.rows[0];
});
app.delete("/api/users/:id", { preHandler: admin }, async (request, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  if (id === request.user.sub) return reply.code(400).send({ error: "No puede eliminar su propia cuenta" });
  const before = (await pool.query("SELECT id,organization_id,email,full_name,role FROM users WHERE id=$1", [id])).rows[0];
  if (!before) return reply.code(404).send({ error: "Usuario no encontrado" });
  if (before.role === "admin" && Number((await pool.query("SELECT count(*) total FROM users WHERE role='admin' AND account_status='active' AND id<>$1", [id])).rows[0].total) === 0) {
    return reply.code(400).send({ error: "Debe permanecer al menos un administrador activo" });
  }
  const counts = (await pool.query(`SELECT
    (SELECT count(*) FROM tickets WHERE requester_id=$1) tickets,
    (SELECT count(*) FROM ticket_comments WHERE author_id=$1) comments,
    (SELECT count(*) FROM attachments WHERE uploaded_by=$1) attachments,
    (SELECT count(*) FROM assets WHERE owner_user_id=$1) assets,
    (SELECT count(*) FROM payment_attempts WHERE user_id=$1) payments`, [id])).rows[0];
  const usedBy = Object.entries(counts).filter(([, count]) => Number(count) > 0).map(([table, count]) => `${table}: ${count}`).join(", ");
  if (usedBy) return reply.code(409).send({ error: `No se puede eliminar el usuario porque tiene historial relacionado (${usedBy}). Inhabilite la cuenta para conservarlo.` });
  await pool.query("INSERT INTO audit_logs(actor_id,organization_id,action,entity_type,entity_id,metadata) VALUES($1,$2,'user.deleted','user',$3,$4)", [request.user.sub, before.organization_id, id, { deleted: before }]);
  await pool.query("DELETE FROM refresh_sessions WHERE user_id=$1", [id]);
  const result = await pool.query("DELETE FROM users WHERE id=$1 RETURNING id", [id]);
  return { deleted: Boolean(result.rowCount) };
});
app.patch("/api/users/:id/status", { preHandler: admin }, async (request, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const body = z.object({ status: z.enum(["active", "suspended", "disabled"]), suspendedUntil: z.iso.datetime().optional(), reason: z.string().trim().min(5).max(500).optional() })
    .refine((value) => value.status !== "suspended" || (value.suspendedUntil && new Date(value.suspendedUntil) > new Date()), { message: "La suspensión requiere una fecha futura" })
    .refine((value) => value.status === "active" || value.reason, { message: "Indique el motivo del cambio de estado" }).parse(request.body);
  const before = (await pool.query("SELECT organization_id,role,account_status,suspended_until,status_reason FROM users WHERE id=$1", [id])).rows[0];
  if (!before) return reply.code(404).send({ error: "Usuario no encontrado" });
  if (id === request.user.sub && body.status !== "active") return reply.code(400).send({ error: "No puede suspender o inhabilitar su propia cuenta" });
  if (before.role === "admin" && body.status !== "active" && Number((await pool.query("SELECT count(*) total FROM users WHERE role='admin' AND account_status='active' AND id<>$1", [id])).rows[0].total) === 0) return reply.code(400).send({ error: "Debe permanecer al menos un administrador activo" });
  const result = await pool.query(`UPDATE users SET account_status=$2,is_active=($2='active'),suspended_until=CASE WHEN $2='suspended' THEN $3::timestamptz ELSE NULL END,
    status_reason=CASE WHEN $2='active' THEN NULL ELSE $4 END,status_changed_at=now(),status_changed_by=$5,updated_at=now() WHERE id=$1
    RETURNING id,account_status,suspended_until,status_reason`, [id, body.status, body.suspendedUntil ?? null, body.reason ?? null, request.user.sub]);
  await pool.query("DELETE FROM refresh_sessions WHERE user_id=$1", [id]);
  await pool.query("INSERT INTO audit_logs(actor_id,organization_id,action,entity_type,entity_id,metadata) VALUES($1,$2,'user.status_changed','user',$3,$4)", [request.user.sub, before.organization_id, id, { before, after: result.rows[0] }]);
  return result.rows[0];
});
app.post("/api/assets", { preHandler: staff }, async (request, reply) => {
  const body = z.object({ organizationId: z.string().uuid(), ownerUserId: z.string().uuid(), assetTag: z.string().min(2).max(80), assetType: z.string().min(2).max(100), brand: z.string().max(100).nullable().optional(), model: z.string().max(120).nullable().optional(), serialNumber: z.string().max(160).nullable().optional(), location: z.string().max(160).nullable().optional() }).parse(request.body);
  if (!canAccessOrganization(request.user, body.organizationId)) return reply.code(403).send({ error: "No puede operar registros de otra empresa" });
  const owner = (await pool.query("SELECT id,full_name FROM users WHERE id=$1 AND organization_id=$2 AND role='client' AND account_status='active'", [body.ownerUserId, body.organizationId])).rows[0];
  if (!owner) return reply.code(400).send({ error: "El propietario debe ser un cliente activo de la empresa seleccionada" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query("INSERT INTO assets(organization_id,owner_user_id,asset_tag,asset_type,brand,model,serial_number,location) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *", [body.organizationId, body.ownerUserId, body.assetTag, body.assetType, body.brand ?? null, body.model ?? null, body.serialNumber ?? null, body.location ?? null]);
    await client.query("INSERT INTO asset_owner_history(asset_id,new_owner_id,new_owner_name,changed_by) VALUES($1,$2,$3,$4)", [result.rows[0].id, owner.id, owner.full_name, request.user.sub]);
    await client.query("COMMIT");
    return reply.code(201).send(result.rows[0]);
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
});
app.post("/api/contacts", { preHandler: staff }, async (request, reply) => {
  const body = z.object({ organizationId: z.string().uuid(), fullName: z.string().min(2).max(160), email: z.string().email().nullable().optional(), phone: z.string().max(40).nullable().optional(), position: z.string().max(100).nullable().optional(), isPrimary: z.boolean().default(false) }).parse(request.body);
  if (!canAccessOrganization(request.user, body.organizationId)) return reply.code(403).send({ error: "No puede operar registros de otra empresa" });
  const result = await pool.query("INSERT INTO contacts(organization_id,full_name,email,phone,position,is_primary) VALUES($1,$2,$3,$4,$5,$6) RETURNING *", [body.organizationId, body.fullName, body.email ?? null, body.phone ?? null, body.position ?? null, body.isPrimary]);
  return reply.code(201).send(result.rows[0]);
});
app.post("/api/orders", { preHandler: staff }, async (request, reply) => {
  const body = z.object({ organizationId: z.string().uuid(), status: z.enum(["draft", "confirmed", "processing", "delivered", "cancelled"]).default("confirmed"), totalCop: z.number().int().min(0), notes: z.string().max(1000).nullable().optional() }).parse(request.body);
  if (!canAccessOrganization(request.user, body.organizationId)) return reply.code(403).send({ error: "No puede operar registros de otra empresa" });
  const result = await pool.query("INSERT INTO orders(organization_id,status,purchased_at,subtotal_cop,total_cop,notes,created_by) VALUES($1,$2,now(),$3,$3,$4,$5) RETURNING *", [body.organizationId, body.status, body.totalCop, body.notes ?? null, request.user.sub]);
  return reply.code(201).send(result.rows[0]);
});
app.patch("/api/assets/:id", { preHandler: staff }, async (request, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const body = z.object({ organizationId: z.string().uuid(), ownerUserId: z.string().uuid(), assetTag: z.string().min(2).max(80), assetType: z.string().min(2).max(100), brand: z.string().max(100).nullable().optional(), model: z.string().max(120).nullable().optional(), serialNumber: z.string().max(160).nullable().optional(), status: z.enum(["active", "in_service", "inactive", "retired", "lost"]), location: z.string().max(160).nullable().optional() }).parse(request.body);
  const owner = (await pool.query("SELECT id,full_name FROM users WHERE id=$1 AND organization_id=$2 AND role='client' AND account_status='active'", [body.ownerUserId, body.organizationId])).rows[0];
  if (!owner) return reply.code(400).send({ error: "El propietario debe ser un cliente activo de la empresa seleccionada" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const before = (await client.query("SELECT a.organization_id,a.owner_user_id,u.full_name owner_name FROM assets a LEFT JOIN users u ON u.id=a.owner_user_id WHERE a.id=$1 FOR UPDATE OF a", [id])).rows[0];
    if (!before) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Equipo no encontrado" }); }
    if (!canAccessOrganization(request.user, before.organization_id) || !canAccessOrganization(request.user, body.organizationId)) { await client.query("ROLLBACK"); return reply.code(403).send({ error: "No puede operar registros de otra empresa" }); }
    const result = await client.query("UPDATE assets SET organization_id=$2,owner_user_id=$3,asset_tag=$4,asset_type=$5,brand=$6,model=$7,serial_number=$8,status=$9,location=$10,updated_at=now() WHERE id=$1 RETURNING *", [id, body.organizationId, body.ownerUserId, body.assetTag, body.assetType, body.brand ?? null, body.model ?? null, body.serialNumber ?? null, body.status, body.location ?? null]);
    if (before.owner_user_id !== body.ownerUserId) await client.query("INSERT INTO asset_owner_history(asset_id,previous_owner_id,new_owner_id,previous_owner_name,new_owner_name,changed_by) VALUES($1,$2,$3,$4,$5,$6)", [id, before.owner_user_id, owner.id, before.owner_name, owner.full_name, request.user.sub]);
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
});
app.delete("/api/assets/:id", { preHandler: staff }, async (request, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const scope = organizationScope(request.user, "assets", 2);
  const result = await pool.query(`DELETE FROM assets WHERE id=$1${scope.sql} RETURNING id`, [id, ...scope.params]);
  if (!result.rowCount) return reply.code(404).send({ error: "Equipo no encontrado" });
  return { deleted: true };
});
app.patch("/api/contacts/:id", { preHandler: staff }, async (request, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const body = z.object({ organizationId: z.string().uuid(), fullName: z.string().min(2).max(160), email: z.string().email().nullable().optional(), phone: z.string().max(40).nullable().optional(), position: z.string().max(100).nullable().optional(), isPrimary: z.boolean(), isActive: z.boolean() }).parse(request.body);
  if (!canAccessOrganization(request.user, body.organizationId)) return reply.code(403).send({ error: "No puede operar registros de otra empresa" });
  const scope = organizationScope(request.user, "contacts", 9);
  const result = await pool.query(`UPDATE contacts SET organization_id=$2,full_name=$3,email=$4,phone=$5,position=$6,is_primary=$7,is_active=$8,updated_at=now() WHERE id=$1${scope.sql} RETURNING *`, [id, body.organizationId, body.fullName, body.email ?? null, body.phone ?? null, body.position ?? null, body.isPrimary, body.isActive, ...scope.params]);
  if (!result.rowCount) return reply.code(404).send({ error: "Contacto no encontrado" });
  return result.rows[0];
});
app.delete("/api/contacts/:id", { preHandler: staff }, async (request, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const scope = organizationScope(request.user, "contacts", 2);
  const result = await pool.query(`DELETE FROM contacts WHERE id=$1${scope.sql} RETURNING id`, [id, ...scope.params]);
  if (!result.rowCount) return reply.code(404).send({ error: "Contacto no encontrado" });
  return { deleted: true };
});
app.patch("/api/orders/:id", { preHandler: staff }, async (request, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const body = z.object({ organizationId: z.string().uuid(), status: z.enum(["draft", "confirmed", "processing", "delivered", "cancelled"]), totalCop: z.number().int().min(0), notes: z.string().max(1000).nullable().optional() }).parse(request.body);
  if (!canAccessOrganization(request.user, body.organizationId)) return reply.code(403).send({ error: "No puede operar registros de otra empresa" });
  const scope = organizationScope(request.user, "orders", 6);
  const result = await pool.query(`UPDATE orders SET organization_id=$2,status=$3,total_cop=$4,subtotal_cop=$4,notes=$5,updated_at=now() WHERE id=$1${scope.sql} RETURNING *`, [id, body.organizationId, body.status, body.totalCop, body.notes ?? null, ...scope.params]);
  if (!result.rowCount) return reply.code(404).send({ error: "Compra no encontrada" });
  return result.rows[0];
});
app.delete("/api/orders/:id", { preHandler: staff }, async (request, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const scope = organizationScope(request.user, "orders", 2);
  const result = await pool.query(`DELETE FROM orders WHERE id=$1${scope.sql} RETURNING id`, [id, ...scope.params]);
  if (!result.rowCount) return reply.code(404).send({ error: "Compra no encontrada" });
  return { deleted: true };
});

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof z.ZodError) return reply.code(400).send({ error: "Datos inválidos", details: error.issues });
  const statusCode = error instanceof Error && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : null;
  const message = error instanceof Error ? error.message : "Solicitud inválida";
  if (statusCode && statusCode < 500) return reply.code(statusCode).send({ error: message });
  app.log.error(error); return reply.code(500).send({ error: "Error interno" });
});

const shutdown = async () => { await app.close(); await pool.end(); process.exit(0); };
process.on("SIGINT", () => void shutdown()); process.on("SIGTERM", () => void shutdown());
await app.listen({ host: config.HOST, port: config.PORT });