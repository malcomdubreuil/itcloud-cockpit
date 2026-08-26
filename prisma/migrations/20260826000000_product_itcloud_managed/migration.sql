-- Produits maison (hébergement, noms de domaine, SSL…) : exclus de la
-- synchronisation ITCloud. true = produit du catalogue ITCloud (défaut).
ALTER TABLE `Product` ADD COLUMN `itcloudManaged` BOOLEAN NOT NULL DEFAULT true;
