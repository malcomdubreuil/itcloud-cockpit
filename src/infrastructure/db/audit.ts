import { prisma } from "@/infrastructure/db/prisma";

// Journal d'audit (doc §8) : connexions, CRUD critiques, syncs, exports,
// changements de rôle. userId null = action système (sync, cron).

export type AuditEntry = {
  tenantId: string;
  userId?: string | null;
  action: string; // "auth.login", "auth.login_failed", "client.update", "sync.run"…
  entityType?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  ip?: string;
  userAgent?: string;
};

export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        tenantId: entry.tenantId,
        userId: entry.userId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        before: entry.before === undefined ? undefined : JSON.parse(JSON.stringify(entry.before)),
        after: entry.after === undefined ? undefined : JSON.parse(JSON.stringify(entry.after)),
        ip: entry.ip,
        userAgent: entry.userAgent,
      },
    });
  } catch (err) {
    // L'audit ne doit jamais faire échouer l'action métier ;
    // l'échec est tracé dans les logs applicatifs.
    console.error("AuditLog write failed", { action: entry.action, err });
  }
}
