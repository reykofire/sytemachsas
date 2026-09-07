import nodemailer from "nodemailer";

import { config } from "./config.js";

type TicketMail = {
  ticket_number: number;
  subject: string;
  description: string;
  priority: string;
  status: string;
  requester_name: string;
  requester_email: string;
  asset_tag?: string | null;
  asset_name?: string | null;
  closure_cause?: string | null;
  closure_note?: string | null;
  closed_at?: string | Date | null;
};

type ContactMail = {
  name: string;
  company: string | undefined;
  email: string;
  phone: string;
  service: string;
  message: string;
  wantsPortalAccess: boolean;
};

const palette = { ink: "#16232f", red: "#006eae", gray: "#687681", pale: "#f5f7f8", line: "#dfe5e8" };
const statusLabels: Record<string, string> = { open: "Abierto", in_progress: "En proceso", pending_customer: "Pendiente del cliente", pending_parts: "Pendiente de repuesto", resolved: "Resuelto", closed: "Cerrado" };
const priorityLabels: Record<string, string> = { low: "Baja", medium: "Media", high: "Alta", urgent: "Urgente" };
const closureCauseLabels: Record<string, string> = { hardware_failure: "Falla de hardware", software_issue: "Problema de software", configuration: "Configuración", user_guidance: "Orientación al usuario", preventive_maintenance: "Mantenimiento preventivo", parts_replacement: "Reemplazo de repuesto", network_issue: "Problema de red", security_incident: "Incidente de seguridad", other: "Otra causa" };

const escapeHtml = (value: unknown) => String(value ?? "-").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" } as Record<string, string>)[char] || char);
const ticketCode = (ticket: TicketMail) => `TK-${String(ticket.ticket_number).padStart(5, "0")}`;
const formatDate = (value: unknown) => value ? new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" }).format(new Date(String(value))) : "-";
const assetText = (ticket: TicketMail) => [ticket.asset_tag, ticket.asset_name].filter(Boolean).join(" · ") || "Sin equipo asociado";

const transport = config.SMTP_PASS
  ? nodemailer.createTransport({ host: config.SMTP_HOST, port: config.SMTP_PORT, secure: config.SMTP_SECURE, auth: { user: config.SMTP_USER, pass: config.SMTP_PASS } })
  : null;

const layout = (title: string, intro: string, body: string) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="margin:0;background:#e9eef1;color:${palette.ink};font-family:Arial,Helvetica,sans-serif"><div style="padding:30px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:0 auto;background:#fff;border:1px solid ${palette.line};border-radius:12px;overflow:hidden;box-shadow:0 8px 24px rgba(22,35,47,.08)"><tr><td style="height:7px;background:${palette.red}"></td></tr><tr><td style="padding:22px 34px 18px;border-bottom:1px solid ${palette.line}"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="vertical-align:middle"><img src="cid:systemach-logo" alt="Systemach" width="144" style="display:block;width:144px;height:auto;border:0"></td><td style="text-align:right;vertical-align:middle;color:${palette.gray};font-size:11px;letter-spacing:1.4px;font-weight:700">CENTRO DE<br>SERVICIO</td></tr></table></td></tr><tr><td style="padding:28px 34px 10px"><div style="display:inline-block;padding:7px 11px;background:#e8f4fc;color:${palette.red};font-size:11px;letter-spacing:1.3px;font-weight:700;border-radius:4px">${escapeHtml(title).toUpperCase()}</div><h1 style="margin:15px 0 8px;font-size:27px;line-height:1.2;color:${palette.ink}">${escapeHtml(title)}</h1><p style="margin:0;color:${palette.gray};font-size:15px;line-height:1.55">${escapeHtml(intro)}</p></td></tr><tr><td style="padding:8px 34px 34px">${body}</td></tr><tr><td style="padding:20px 34px;background:${palette.pale};border-top:1px solid ${palette.line}"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="color:${palette.ink};font-size:12px;font-weight:700">Systemach</td><td style="text-align:right;color:${palette.gray};font-size:11px">Centro de servicio y soporte</td></tr></table><p style="margin:9px 0 0;color:${palette.gray};font-size:11px;line-height:1.5">Mensaje automático del sistema. No respondas a este correo; utiliza el portal para consultar o actualizar tu solicitud.</p></td></tr></table></div></body></html>`;

const detailRows = (ticket: TicketMail) => `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;border-spacing:0;margin:22px 0;border:1px solid ${palette.line};border-radius:8px;overflow:hidden"><tr><td style="padding:13px 15px;background:${palette.pale};color:${palette.gray};font-size:11px;font-weight:700;letter-spacing:.4px;width:42%">NÚMERO DE TICKET</td><td style="padding:13px 15px;background:${palette.pale};font-weight:700;color:${palette.red}">${ticketCode(ticket)}</td></tr><tr><td style="padding:13px 15px;border-top:1px solid ${palette.line};color:${palette.gray};font-size:11px;font-weight:700;letter-spacing:.4px">DESCRIPCIÓN</td><td style="padding:13px 15px;border-top:1px solid ${palette.line}">${escapeHtml(ticket.subject)}</td></tr><tr><td style="padding:13px 15px;border-top:1px solid ${palette.line};color:${palette.gray};font-size:11px;font-weight:700;letter-spacing:.4px">ACTIVO AFECTADO</td><td style="padding:13px 15px;border-top:1px solid ${palette.line}">${escapeHtml(assetText(ticket))}</td></tr><tr><td style="padding:13px 15px;border-top:1px solid ${palette.line};color:${palette.gray};font-size:11px;font-weight:700;letter-spacing:.4px">PRIORIDAD</td><td style="padding:13px 15px;border-top:1px solid ${palette.line}">${escapeHtml(priorityLabels[ticket.priority] || ticket.priority)}</td></tr></table>`;

const createdHtml = (ticket: TicketMail) => layout("Solicitud recibida", `Hola ${ticket.requester_name}, registramos tu solicitud de servicio.`, `${detailRows(ticket)}<div style="padding:16px 18px;background:${palette.pale};border-left:4px solid ${palette.red};font-size:14px;line-height:1.6"><strong>Detalle reportado</strong><br>${escapeHtml(ticket.description)}</div><p style="margin:24px 0 0;font-size:14px;line-height:1.6">Nuestro equipo revisará la solicitud y actualizará su avance en el portal.</p><a href="${escapeHtml(config.PORTAL_URL)}" style="display:inline-block;margin-top:14px;padding:12px 18px;background:${palette.red};color:#fff;text-decoration:none;border-radius:6px;font-weight:700">Consultar solicitud</a>`);
const staffCreatedHtml = (ticket: TicketMail) => layout("Nueva solicitud de servicio", `Se registró un ticket de ${ticket.requester_name} y requiere revisión del equipo.`, `${detailRows(ticket)}<div style="padding:16px 18px;background:#fff8f7;border-left:4px solid ${palette.red};font-size:14px;line-height:1.6"><strong>Detalle reportado por el cliente</strong><br>${escapeHtml(ticket.description)}</div><p style="margin:24px 0 0;font-size:14px;line-height:1.6">Ingresa al portal para asignar, diagnosticar y dar seguimiento a la solicitud.</p><a href="${escapeHtml(config.PORTAL_URL)}" style="display:inline-block;margin-top:14px;padding:12px 18px;background:${palette.red};color:#fff;text-decoration:none;border-radius:6px;font-weight:700">Abrir centro de servicio</a>`);
const closedHtml = (ticket: TicketMail) => layout("Solicitud cerrada", `Hola ${ticket.requester_name}, tu solicitud fue cerrada con soporte documentado.`, `${detailRows(ticket)}<div style="padding:16px 18px;background:#f2faf5;border-left:4px solid #177245;font-size:14px;line-height:1.6"><strong>ESTADO FINAL: CERRADO</strong><br><span style="color:${palette.gray}">Causa:</span> ${escapeHtml(closureCauseLabels[ticket.closure_cause || ""] || ticket.closure_cause)}<br><span style="color:${palette.gray}">Solución aplicada:</span> ${escapeHtml(ticket.closure_note)}</div><p style="margin:24px 0 0;font-size:14px;line-height:1.6">Consulta el expediente completo y el historial de atención en el portal.</p><a href="${escapeHtml(config.PORTAL_URL)}" style="display:inline-block;margin-top:14px;padding:12px 18px;background:${palette.red};color:#fff;text-decoration:none;border-radius:6px;font-weight:700">Ver expediente</a>`);
const contactHtml = (request: ContactMail) => layout("Solicitud recibida", `Hola ${request.name}, recibimos tu solicitud de atención.`, `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;border-spacing:0;margin:22px 0;border:1px solid ${palette.line};border-radius:8px;overflow:hidden"><tr><td style="padding:13px 15px;background:${palette.pale};color:${palette.gray};font-size:11px;font-weight:700;width:38%">SERVICIO</td><td style="padding:13px 15px;background:${palette.pale};font-weight:700">${escapeHtml(request.service)}</td></tr><tr><td style="padding:13px 15px;border-top:1px solid ${palette.line};color:${palette.gray};font-size:11px;font-weight:700">TELÉFONO</td><td style="padding:13px 15px;border-top:1px solid ${palette.line}">${escapeHtml(request.phone)}</td></tr><tr><td style="padding:13px 15px;border-top:1px solid ${palette.line};color:${palette.gray};font-size:11px;font-weight:700">ACCESO AL PORTAL</td><td style="padding:13px 15px;border-top:1px solid ${palette.line}">${request.wantsPortalAccess ? "Solicitado" : "No solicitado"}</td></tr></table><div style="padding:16px 18px;background:${palette.pale};border-left:4px solid ${palette.red};font-size:14px;line-height:1.6"><strong>Detalle de tu solicitud</strong><br>${escapeHtml(request.message)}</div><p style="margin:24px 0 0;font-size:14px;line-height:1.6">Nuestro equipo revisará la información y te contactará en menos de 24 horas hábiles.</p><a href="${escapeHtml(config.PORTAL_URL)}" style="display:inline-block;margin-top:14px;padding:12px 18px;background:${palette.red};color:#fff;text-decoration:none;border-radius:6px;font-weight:700">Abrir helpdesk</a>`);
const staffContactHtml = (request: ContactMail) => layout("Nueva solicitud de atención", `${request.name} solicita información sobre ${request.service}.`, `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;border-spacing:0;margin:22px 0;border:1px solid ${palette.line};border-radius:8px;overflow:hidden"><tr><td style="padding:13px 15px;background:${palette.pale};color:${palette.gray};font-size:11px;font-weight:700;width:38%">CLIENTE</td><td style="padding:13px 15px;background:${palette.pale};font-weight:700">${escapeHtml(request.name)}${request.company ? ` · ${escapeHtml(request.company)}` : ""}</td></tr><tr><td style="padding:13px 15px;border-top:1px solid ${palette.line};color:${palette.gray};font-size:11px;font-weight:700">CONTACTO</td><td style="padding:13px 15px;border-top:1px solid ${palette.line}">${escapeHtml(request.email)} · ${escapeHtml(request.phone)}</td></tr><tr><td style="padding:13px 15px;border-top:1px solid ${palette.line};color:${palette.gray};font-size:11px;font-weight:700">SERVICIO</td><td style="padding:13px 15px;border-top:1px solid ${palette.line}">${escapeHtml(request.service)}</td></tr><tr><td style="padding:13px 15px;border-top:1px solid ${palette.line};color:${palette.gray};font-size:11px;font-weight:700">ACCESO AL PORTAL</td><td style="padding:13px 15px;border-top:1px solid ${palette.line};font-weight:700;color:${request.wantsPortalAccess ? palette.red : palette.gray}">${request.wantsPortalAccess ? "SOLICITADO" : "No solicitado"}</td></tr></table><div style="padding:16px 18px;background:#fff8f7;border-left:4px solid ${palette.red};font-size:14px;line-height:1.6"><strong>Necesidad reportada</strong><br>${escapeHtml(request.message)}</div><a href="${escapeHtml(config.PORTAL_URL)}" style="display:inline-block;margin-top:18px;padding:12px 18px;background:${palette.red};color:#fff;text-decoration:none;border-radius:6px;font-weight:700">Abrir helpdesk</a>`);

async function sendTicketMail(ticket: TicketMail, event: "created" | "closed", recipients = [ticket.requester_email], staff = false) {
  if (!transport || !recipients.length) return false;
  const [primaryRecipient, ...hiddenRecipients] = recipients;
  await transport.sendMail({ from: config.SMTP_FROM, to: primaryRecipient, bcc: hiddenRecipients, subject: `${staff ? "Nueva solicitud" : event === "created" ? "Solicitud recibida" : "Solicitud cerrada"} · ${ticketCode(ticket)} · Systemach`, html: staff ? staffCreatedHtml(ticket) : event === "created" ? createdHtml(ticket) : closedHtml(ticket), text: `${staff ? "Nueva solicitud" : event === "created" ? "Solicitud recibida" : "Solicitud cerrada"}: ${ticketCode(ticket)} - ${ticket.subject}. Consulta el portal Systemach.`, attachments: [{ filename: "logo-systemach.png", path: "/app/Logo/logo-systemach.png", cid: "systemach-logo" }] });
  return true;
}

export async function notifyTicketCreated(ticket: TicketMail) { return sendTicketMail(ticket, "created"); }
export async function notifyStaffTicketCreated(ticket: TicketMail, recipients: string[]) { return sendTicketMail(ticket, "created", recipients, true); }
export async function notifyTicketClosed(ticket: TicketMail) { return sendTicketMail(ticket, "closed"); }
export async function notifyContactRequest(request: ContactMail, recipients: string[]) {
  if (!transport || !recipients.length) return false;
  const [primaryRecipient, ...hiddenRecipients] = recipients;
  await transport.sendMail({ from: config.SMTP_FROM, to: primaryRecipient, bcc: hiddenRecipients, replyTo: request.email, subject: `Nueva solicitud de atención · ${request.service} · Systemach`, html: staffContactHtml(request), text: `Nueva solicitud de ${request.name} (${request.email}) sobre ${request.service}: ${request.message}`, attachments: [{ filename: "logo-systemach.png", path: "/app/Logo/logo-systemach.png", cid: "systemach-logo" }] });
  return true;
}
export async function notifyContactConfirmation(request: ContactMail) {
  if (!transport) return false;
  await transport.sendMail({ from: config.SMTP_FROM, to: request.email, subject: `Solicitud recibida · Systemach`, html: contactHtml(request), text: `Hola ${request.name}, recibimos tu solicitud sobre ${request.service}. Te contactaremos pronto.`, attachments: [{ filename: "logo-systemach.png", path: "/app/Logo/logo-systemach.png", cid: "systemach-logo" }] });
  return true;
}
export const mailerEnabled = Boolean(transport);
