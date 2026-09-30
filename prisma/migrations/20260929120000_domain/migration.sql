-- Le domaine devient un objet à part entière, au lieu d'un bout de texte
-- dans la note du service.
CREATE TABLE `Domain` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `endClientName` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Domain_tenantId_name_key`(`tenantId`, `name`),
    INDEX `Domain_tenantId_endClientName_idx`(`tenantId`, `endClientName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ClientService` ADD COLUMN `domainId` VARCHAR(191) NULL;

CREATE INDEX `ClientService_tenantId_domainId_idx` ON `ClientService`(`tenantId`, `domainId`);

ALTER TABLE `Domain` ADD CONSTRAINT `Domain_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `ClientService` ADD CONSTRAINT `ClientService_domainId_fkey`
    FOREIGN KEY (`domainId`) REFERENCES `Domain`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
