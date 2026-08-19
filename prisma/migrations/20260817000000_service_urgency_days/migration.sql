-- Seuil d'urgence par service : nb de jours avant échéance où la carte passe au rouge (30/45/60)
ALTER TABLE `ClientService` ADD COLUMN `urgencyDays` INT NOT NULL DEFAULT 30;
