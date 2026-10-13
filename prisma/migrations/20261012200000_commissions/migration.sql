-- Part d'un employé (Malcom) sur les revenus récurrents : une règle par
-- client engendre des lignes dues, soldées par des paiements.
CREATE TABLE `Commission` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `beneficiaire` VARCHAR(191) NOT NULL DEFAULT 'Malcom',
    `libelle` VARCHAR(191) NOT NULL,
    `taskId` VARCHAR(191) NULL,
    `montant` DECIMAL(12, 2) NOT NULL,
    `periodeMois` INTEGER NOT NULL DEFAULT 1,
    `dateDebut` DATETIME(3) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    INDEX `Commission_tenantId_active_idx`(`tenantId`, `active`),
    INDEX `Commission_taskId_idx`(`taskId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
;
CREATE TABLE `CommissionPaiement` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `beneficiaire` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `total` DECIMAL(12, 2) NOT NULL,
    `note` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `CommissionPaiement_tenantId_date_idx`(`tenantId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
;
CREATE TABLE `CommissionDue` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `commissionId` VARCHAR(191) NOT NULL,
    `dateDue` DATETIME(3) NOT NULL,
    `montant` DECIMAL(12, 2) NOT NULL,
    `origine` VARCHAR(191) NOT NULL DEFAULT 'calendrier',
    `factureNo` VARCHAR(191) NULL,
    `paiementId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `CommissionDue_commissionId_dateDue_idx`(`commissionId`, `dateDue`),
    INDEX `CommissionDue_tenantId_paiementId_idx`(`tenantId`, `paiementId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
;
ALTER TABLE `Commission` ADD CONSTRAINT `Commission_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
;
ALTER TABLE `Commission` ADD CONSTRAINT `Commission_taskId_fkey`
    FOREIGN KEY (`taskId`) REFERENCES `RecurringTask`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
;
ALTER TABLE `CommissionDue` ADD CONSTRAINT `CommissionDue_commissionId_fkey`
    FOREIGN KEY (`commissionId`) REFERENCES `Commission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
;
ALTER TABLE `CommissionDue` ADD CONSTRAINT `CommissionDue_paiementId_fkey`
    FOREIGN KEY (`paiementId`) REFERENCES `CommissionPaiement`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
;
