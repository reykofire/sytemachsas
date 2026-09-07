import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import argon2 from "argon2";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import PDFDocument from "pdfkit";
import sharp from "sharp";
import { z } from "zod";

import { ticketScope, type Role } from "./access.js";
import { config } from "./config.js";
import { pool } from "./database.js";

type AuthUser = { sub: string; organizationId: string | null; organizationName?: string; role: Role; name: string };
declare module "@fastify/jwt" { interface FastifyJWT { payload: AuthUser; user: AuthUser } }

const app = Fastify({ logger: { level: config.NODE_ENV === "production" ? "info" : "debug" }, trustProxy: true });
await app.register(jwt, { secret: config.JWT_SECRET, sign: { expiresIn: "8h" } });
await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
await mkdir(config.ATTACHMENTS_PATH, { recursive: true });

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

app.post("/api/auth/login", async (request, reply) => {
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
  if (body.assetId && !(await pool.query("SELECT 1 FROM assets WHERE id=$1 AND owner_user_id=$2 AND organization_id IS NOT DISTINCT FROM $3", [body.assetId, clientId, organizationId])).rowCount) return reply.code(400).send({ error: "El equipo no pertenece al usuario seleccionado" });
  const result = await pool.query(
    `INSERT INTO tickets(organization_id,requester_id,asset_id,subject,description,priority,category)
     VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [organizationId, clientId, body.assetId ?? null, body.subject, body.description, body.priority, body.category]);
  await pool.query("INSERT INTO ticket_events(ticket_id,actor_id,event_type,new_value) VALUES($1,$2,'created',$3)", [result.rows[0].id, request.user.sub, { status: "open" }]);
  return reply.code(201).send(result.rows[0]);
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
  const filter = request.user.role === "client" ? " WHERE a.owner_user_id=$1" : "";
  const result = await pool.query(`SELECT a.*,u.full_name owner_name,u.email owner_email
    FROM assets a LEFT JOIN users u ON u.id=a.owner_user_id${filter} ORDER BY a.asset_tag`, request.user.role === "client" ? [request.user.sub] : []);
  return { items: result.rows };
});

for (const [path, table, order] of [["orders", "orders", "created_at"], ["contacts", "contacts", "full_name"]] as const) {
  app.get(`/api/${path}`, { preHandler: auth }, async (request) => {
    const filter = request.user.role === "client" ? " WHERE organization_id=$1" : "";
    return { items: (await pool.query(`SELECT * FROM ${table}${filter} ORDER BY ${order}`, request.user.role === "client" ? [request.user.organizationId] : [])).rows };
  });
}
app.get("/api/operators", { preHandler: staff }, async () => ({ items: (await pool.query("SELECT id,full_name FROM users WHERE role IN ('agent','supervisor','admin') AND account_status='active' ORDER BY full_name")).rows }));

app.get("/api/organizations", { preHandler: staff }, async () => ({ items: (await pool.query("SELECT id,name,email,phone,city,is_active,organization_type FROM organizations ORDER BY name")).rows }));
app.get("/api/ticket-clients", { preHandler: staff }, async () => ({ items: (await pool.query("SELECT u.id,u.full_name,u.email,u.phone,u.organization_id,o.name organization_name FROM users u LEFT JOIN organizations o ON o.id=u.organization_id WHERE u.role='client' AND u.account_status='active' ORDER BY u.full_name")).rows }));
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
    (SELECT count(*) FROM assets WHERE owner_user_id=$1) assets`, [id])).rows[0];
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
  const result = await pool.query("INSERT INTO contacts(organization_id,full_name,email,phone,position,is_primary) VALUES($1,$2,$3,$4,$5,$6) RETURNING *", [body.organizationId, body.fullName, body.email ?? null, body.phone ?? null, body.position ?? null, body.isPrimary]);
  return reply.code(201).send(result.rows[0]);
});
app.post("/api/orders", { preHandler: staff }, async (request, reply) => {
  const body = z.object({ organizationId: z.string().uuid(), status: z.enum(["draft", "confirmed", "processing", "delivered", "cancelled"]).default("confirmed"), totalCop: z.number().int().min(0), notes: z.string().max(1000).nullable().optional() }).parse(request.body);
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
    const before = (await client.query("SELECT a.owner_user_id,u.full_name owner_name FROM assets a LEFT JOIN users u ON u.id=a.owner_user_id WHERE a.id=$1 FOR UPDATE OF a", [id])).rows[0];
    if (!before) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Equipo no encontrado" }); }
    const result = await client.query("UPDATE assets SET organization_id=$2,owner_user_id=$3,asset_tag=$4,asset_type=$5,brand=$6,model=$7,serial_number=$8,status=$9,location=$10,updated_at=now() WHERE id=$1 RETURNING *", [id, body.organizationId, body.ownerUserId, body.assetTag, body.assetType, body.brand ?? null, body.model ?? null, body.serialNumber ?? null, body.status, body.location ?? null]);
    if (before.owner_user_id !== body.ownerUserId) await client.query("INSERT INTO asset_owner_history(asset_id,previous_owner_id,new_owner_id,previous_owner_name,new_owner_name,changed_by) VALUES($1,$2,$3,$4,$5,$6)", [id, before.owner_user_id, owner.id, before.owner_name, owner.full_name, request.user.sub]);
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
});
app.delete("/api/assets/:id", { preHandler: staff }, async (request, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const result = await pool.query("DELETE FROM assets WHERE id=$1 RETURNING id", [id]);
  if (!result.rowCount) return reply.code(404).send({ error: "Equipo no encontrado" });
  return { deleted: true };
});
app.patch("/api/contacts/:id", { preHandler: staff }, async (request, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const body = z.object({ organizationId: z.string().uuid(), fullName: z.string().min(2).max(160), email: z.string().email().nullable().optional(), phone: z.string().max(40).nullable().optional(), position: z.string().max(100).nullable().optional(), isPrimary: z.boolean(), isActive: z.boolean() }).parse(request.body);
  const result = await pool.query("UPDATE contacts SET organization_id=$2,full_name=$3,email=$4,phone=$5,position=$6,is_primary=$7,is_active=$8,updated_at=now() WHERE id=$1 RETURNING *", [id, body.organizationId, body.fullName, body.email ?? null, body.phone ?? null, body.position ?? null, body.isPrimary, body.isActive]);
  if (!result.rowCount) return reply.code(404).send({ error: "Contacto no encontrado" });
  return result.rows[0];
});
app.delete("/api/contacts/:id", { preHandler: staff }, async (request, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const result = await pool.query("DELETE FROM contacts WHERE id=$1 RETURNING id", [id]);
  if (!result.rowCount) return reply.code(404).send({ error: "Contacto no encontrado" });
  return { deleted: true };
});
app.patch("/api/orders/:id", { preHandler: staff }, async (request, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const body = z.object({ organizationId: z.string().uuid(), status: z.enum(["draft", "confirmed", "processing", "delivered", "cancelled"]), totalCop: z.number().int().min(0), notes: z.string().max(1000).nullable().optional() }).parse(request.body);
  const result = await pool.query("UPDATE orders SET organization_id=$2,status=$3,total_cop=$4,subtotal_cop=$4,notes=$5,updated_at=now() WHERE id=$1 RETURNING *", [id, body.organizationId, body.status, body.totalCop, body.notes ?? null]);
  if (!result.rowCount) return reply.code(404).send({ error: "Compra no encontrada" });
  return result.rows[0];
});
app.delete("/api/orders/:id", { preHandler: staff }, async (request, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const result = await pool.query("DELETE FROM orders WHERE id=$1 RETURNING id", [id]);
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