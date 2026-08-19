-- Échéance fixée manuellement : protégée de la synchronisation
ALTER TABLE `ClientService` ADD COLUMN `renewalDateManual` BOOLEAN NOT NULL DEFAULT false;
