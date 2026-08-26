-- Fin de la période d'engagement ITCloud, pour l'afficher sur les factures
ALTER TABLE `ClientService` ADD COLUMN `commitmentEndDate` DATETIME(3) NULL;
