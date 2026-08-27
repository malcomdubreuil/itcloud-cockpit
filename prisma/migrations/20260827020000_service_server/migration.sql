-- Serveur / revendeur qui porte le service. Les tarifs de Keven different d'un
-- serveur a l'autre pour un meme produit, donc il faut pouvoir filtrer dessus.
ALTER TABLE `ClientService` ADD COLUMN `serverName` VARCHAR(191) NULL;

-- Recuperation depuis la note, au format « domaine · serveur X ».
UPDATE `ClientService`
   SET `serverName` = TRIM(SUBSTRING_INDEX(`notes`, 'serveur ', -1))
 WHERE `notes` LIKE '%· serveur %';

CREATE INDEX `ClientService_tenantId_serverName_idx` ON `ClientService`(`tenantId`, `serverName`);
