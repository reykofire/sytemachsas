export type Role = "client" | "agent" | "supervisor" | "admin";

type TicketUser = { sub: string; role: Role };
type OrganizationUser = { role: Role; organizationId: string | null };

export function ticketScope(user: TicketUser, alias = "t", parameter = 2) {
  if (user.role === "client") return { sql: ` AND ${alias}.requester_id=$${parameter}`, params: [user.sub] };
  if (user.role === "agent") return { sql: ` AND ${alias}.assigned_to=$${parameter}`, params: [user.sub] };
  return { sql: "", params: [] as string[] };
}

export function organizationScope(user: OrganizationUser, alias: string, parameter = 1, column = "organization_id") {
  if (user.role === "supervisor" || user.role === "admin") return { sql: "", params: [] as string[] };
  return { sql: ` AND ${alias}.${column}=$${parameter}`, params: [user.organizationId ?? ""] };
}

export function canAccessOrganization(user: OrganizationUser, organizationId: string | null) {
  return user.role === "supervisor" || user.role === "admin" || Boolean(user.organizationId && user.organizationId === organizationId);
}