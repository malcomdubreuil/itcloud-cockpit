-- PDSF / coût saisis à la main : protégés de la synchro et des ré-imports
ALTER TABLE `Product` ADD COLUMN `priceManual` BOOLEAN NOT NULL DEFAULT false;
