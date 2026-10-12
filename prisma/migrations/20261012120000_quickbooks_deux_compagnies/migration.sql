-- Deux compagnies QuickBooks depuis l'incorporation (octobre 2026).
-- Les clients QuickBooks portent la compagnie dans leur clé ; les numéros de
-- facture mémorisent la compagnie qui les a émis. Le remplissage des lignes
-- existantes (ancienne compagnie) est fait par scripts/transition-quickbooks.mts.
ALTER TABLE `QboCustomer` ADD COLUMN `realmId` VARCHAR(191) NOT NULL DEFAULT '';
ALTER TABLE `QboCustomer` DROP INDEX `QboCustomer_tenantId_qboId_key`;
CREATE UNIQUE INDEX `QboCustomer_tenantId_realmId_qboId_key` ON `QboCustomer`(`tenantId`, `realmId`, `qboId`);
ALTER TABLE `ClientService` ADD COLUMN `lastQbInvoiceRealm` VARCHAR(191) NULL;
ALTER TABLE `RecurringTask` ADD COLUMN `lastQbInvoiceRealm` VARCHAR(191) NULL;
