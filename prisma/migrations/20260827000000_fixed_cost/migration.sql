-- Cout fixe d'exploitation : un montant global revendu reparti sur plusieurs
-- clients (serveur, licence illimitee, certificat wildcard). A l'oppose de
-- ClientService.unitCost qui est un cout PAR licence.
CREATE TABLE `FixedCost` (
  `id`         VARCHAR(191) NOT NULL,
  `tenantId`   VARCHAR(191) NOT NULL,
  `division`   VARCHAR(191) NOT NULL,
  `label`      VARCHAR(191) NOT NULL,
  `amount`     DECIMAL(12,4) NOT NULL,
  `cycle`      ENUM('MENSUEL','ANNUEL','TRIMESTRIEL') NOT NULL,
  `productId`  VARCHAR(191) NULL,
  `serverName` VARCHAR(191) NULL,
  `note`       TEXT NULL,
  `active`     BOOLEAN NOT NULL DEFAULT true,
  `deletedAt`  DATETIME(3) NULL,
  `createdAt`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`  DATETIME(3) NOT NULL,
  INDEX `FixedCost_tenantId_division_idx` (`tenantId`, `division`),
  INDEX `FixedCost_tenantId_productId_idx` (`tenantId`, `productId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `FixedCost` ADD CONSTRAINT `FixedCost_tenantId_fkey`
  FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `FixedCost` ADD CONSTRAINT `FixedCost_productId_fkey`
  FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
