-- Client interne (ma propre entreprise) : prix forcés à 0, pas de facturation
ALTER TABLE `Client` ADD COLUMN `internal` BOOLEAN NOT NULL DEFAULT false;
