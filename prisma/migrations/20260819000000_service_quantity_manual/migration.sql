-- Quantité fixée manuellement : la synchronisation ITCloud ne l'écrase plus
ALTER TABLE `ClientService` ADD COLUMN `quantityManual` BOOLEAN NOT NULL DEFAULT false;
