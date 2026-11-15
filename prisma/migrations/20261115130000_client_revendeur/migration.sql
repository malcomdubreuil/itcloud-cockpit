-- Un client « facturé via » un revendeur (Pclogic, Acxzon…) : chaque client
-- final a sa propre fiche, et pointe vers le revendeur qui reçoit la facture
-- (Keven, 2026-11-15).
ALTER TABLE `Client` ADD COLUMN `resellerId` VARCHAR(191) NULL;
CREATE INDEX `Client_resellerId_idx` ON `Client`(`resellerId`);
ALTER TABLE `Client` ADD CONSTRAINT `Client_resellerId_fkey`
    FOREIGN KEY (`resellerId`) REFERENCES `Client`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
