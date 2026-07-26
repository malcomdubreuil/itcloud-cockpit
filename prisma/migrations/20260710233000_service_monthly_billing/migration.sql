-- Facturation au mois par service : avance les dates de +1 mois à la refacturation
ALTER TABLE `ClientService` ADD COLUMN `monthlyBilling` BOOLEAN NOT NULL DEFAULT false;
