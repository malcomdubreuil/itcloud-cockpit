-- Division d'appartenance du client (utile pour un client manuel sans service)
ALTER TABLE `Client` ADD COLUMN `division` VARCHAR(191) NOT NULL DEFAULT 'ITCLOUD';
