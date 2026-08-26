-- Seuil d'alerte déplacé au niveau du CLIENT (au lieu de chaque service)
ALTER TABLE `Client` ADD COLUMN `urgencyDays` INT NOT NULL DEFAULT 30;
