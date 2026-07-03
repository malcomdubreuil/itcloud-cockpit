import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

// Seed initial (doc §4) : tenant unique (v1 mono-tenant), 4 rôles, admin,
// compteur de facturation. Idempotent — rejouable sans doublons.

const prisma = new PrismaClient();

const ROLES: { name: string; permissions: string[] }[] = [
  { name: "Admin", permissions: ["*"] },
  {
    name: "Gestionnaire",
    permissions: [
      "clients:*",
      "services:*",
      "products:read",
      "invoices:read",
      "alerts:*",
      "reports:*",
      "sync:run",
    ],
  },
  {
    name: "Comptable",
    permissions: ["clients:read", "services:read", "invoices:*", "reports:*"],
  },
  {
    name: "Lecture",
    permissions: [
      "clients:read",
      "services:read",
      "products:read",
      "invoices:read",
      "alerts:read",
      "reports:read",
    ],
  },
];

async function main() {
  const tenantName = process.env.SEED_TENANT_NAME ?? "Mon entreprise TI";
  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? "admin@cockpit.local").toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;

  if (!adminPassword || adminPassword.length < 12) {
    throw new Error("SEED_ADMIN_PASSWORD requis (12 caractères minimum)");
  }

  let tenant = await prisma.tenant.findFirst();
  if (!tenant) {
    tenant = await prisma.tenant.create({ data: { name: tenantName } });
    console.log(`Tenant créé : ${tenant.name}`);
  }

  for (const role of ROLES) {
    await prisma.role.upsert({
      where: { tenantId_name: { tenantId: tenant.id, name: role.name } },
      update: { permissions: role.permissions },
      create: {
        tenantId: tenant.id,
        name: role.name,
        permissions: role.permissions,
      },
    });
  }
  console.log(`${ROLES.length} rôles en place`);

  const adminRole = await prisma.role.findUniqueOrThrow({
    where: { tenantId_name: { tenantId: tenant.id, name: "Admin" } },
  });

  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!existingAdmin) {
    await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: adminEmail,
        name: "Administrateur",
        passwordHash: await bcrypt.hash(adminPassword, 12),
        roleId: adminRole.id,
      },
    });
    console.log(`Admin créé : ${adminEmail} (changer le mot de passe à la première connexion)`);
  }

  await prisma.invoiceSequence.upsert({
    where: { tenantId: tenant.id },
    update: {},
    create: { tenantId: tenant.id, nextNumber: 1 },
  });

  console.log("Seed terminé ✔");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
