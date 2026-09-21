-- Tâches récurrentes (3e division) : table dédiée, séparée des produits/services
CREATE TABLE `RecurringTask` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `price` DECIMAL(12, 4) NOT NULL,
    `periodDays` INTEGER NOT NULL DEFAULT 30,
    `nextDueDate` DATETIME(3) NULL,
    `lastQbInvoiceNo` VARCHAR(191) NULL,
    `lastBilledAt` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `RecurringTask_tenantId_nextDueDate_idx`(`tenantId`, `nextDueDate`),
    INDEX `RecurringTask_tenantId_clientId_idx`(`tenantId`, `clientId`),
    INDEX `RecurringTask_tenantId_active_idx`(`tenantId`, `active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `RecurringTask` ADD CONSTRAINT `RecurringTask_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `RecurringTask` ADD CONSTRAINT `RecurringTask_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
