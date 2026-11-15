-- Tâche récurrente : un nom de client tapé librement, quand le client n'est
-- ni dans QuickBooks ni dans l'ERP (Keven, 2026-11-15).
ALTER TABLE `RecurringTask` ADD COLUMN `clientNom` VARCHAR(191) NULL;
