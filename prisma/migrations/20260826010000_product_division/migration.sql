-- Division commerciale du produit : ITCLOUD (licences) ou HEBERGEMENT (web).
-- Une 3e division est prevue, d'ou une chaine plutot qu'un booleen.
ALTER TABLE `Product` ADD COLUMN `division` VARCHAR(191) NOT NULL DEFAULT 'ITCLOUD';

-- Les produits maison importes du fichier d'hebergement passent du bon cote.
UPDATE `Product` SET `division` = 'HEBERGEMENT' WHERE `itcloudManaged` = 0;
