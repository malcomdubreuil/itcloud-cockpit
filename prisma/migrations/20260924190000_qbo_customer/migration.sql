-- Clients QuickBooks dans leur PROPRE table : deux referentiels distincts, on
-- ne les melange pas aux fiches Client de l'ERP.
CREATE TABLE `QboCustomer` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `qboId` VARCHAR(191) NOT NULL,
    `displayName` VARCHAR(191) NOT NULL,
    `companyName` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `syncedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `QboCustomer_tenantId_qboId_key`(`tenantId`, `qboId`),
    INDEX `QboCustomer_tenantId_active_idx`(`tenantId`, `active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `QboCustomer` ADD CONSTRAINT `QboCustomer_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Une tache n'est plus obligee d'avoir un client de l'ERP.
ALTER TABLE `RecurringTask` MODIFY COLUMN `clientId` VARCHAR(191) NULL;

-- Et peut viser un client QuickBooks a la place.
ALTER TABLE `RecurringTask` ADD COLUMN `qboCustomerId` VARCHAR(191) NULL;
ALTER TABLE `RecurringTask` ADD CONSTRAINT `RecurringTask_qboCustomerId_fkey` FOREIGN KEY (`qboCustomerId`) REFERENCES `QboCustomer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
