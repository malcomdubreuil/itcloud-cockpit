// RBAC (doc §8) : permissions de la forme "ressource:action"
// (ex. "clients:read", "invoices:write"). "*" = toutes les permissions (Admin).
// Vérifié dans chaque use-case ET au niveau du middleware/pages.

export type Permission = string; // "clients:read" | "invoices:write" | "*" | "clients:*"

export type AuthorizedUser = {
  id: string;
  tenantId: string;
  roleId: string;
  permissions: Permission[];
};

export function can(user: AuthorizedUser, permission: Permission): boolean {
  if (user.permissions.includes("*")) return true;
  if (user.permissions.includes(permission)) return true;

  // "clients:*" couvre "clients:read", "clients:write"…
  const [resource] = permission.split(":");
  return user.permissions.includes(`${resource}:*`);
}

export function assertCan(user: AuthorizedUser, permission: Permission): void {
  if (!can(user, permission)) {
    throw new ForbiddenError(permission);
  }
}

export class ForbiddenError extends Error {
  constructor(permission: Permission) {
    super(`Permission refusée : ${permission}`);
    this.name = "ForbiddenError";
  }
}
