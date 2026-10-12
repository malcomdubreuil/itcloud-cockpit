-- Correspondance des objets QuickBooks entre l'ancienne et la nouvelle compagnie.
CREATE TABLE `QboCorrespondance` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `sourceRealm` VARCHAR(191) NOT NULL,
    `sourceId` VARCHAR(191) NOT NULL,
    `sourceName` VARCHAR(191) NOT NULL,
    `targetRealm` VARCHAR(191) NOT NULL,
    `targetId` VARCHAR(191) NULL,
    `targetName` VARCHAR(191) NULL,
    `auto` BOOLEAN NOT NULL DEFAULT true,
    `methode` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `QboCorrespondance_tenantId_kind_sourceRealm_sourceId_key`(`tenantId`, `kind`, `sourceRealm`, `sourceId`),
    INDEX `QboCorrespondance_tenantId_kind_targetId_idx`(`tenantId`, `kind`, `targetId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
;
ALTER TABLE `QboCorrespondance` ADD CONSTRAINT `QboCorrespondance_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
