-- Presentation d un produit sur la facture : tarif mensuel x 12 (true) ou prix du cycle x 1.
ALTER TABLE `Product` ADD COLUMN `factureAuMois` BOOLEAN NOT NULL DEFAULT false;
