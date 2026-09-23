-- Liste de diffusion (4e division) : tables dédiées, aucun lien avec la facturation

CREATE TABLE `MailingContact` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NULL,
    `email` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `role` VARCHAR(191) NULL,
    `consent` VARCHAR(191) NOT NULL DEFAULT 'TACITE',
    `consentSource` VARCHAR(191) NULL,
    `consentAt` DATETIME(3) NULL,
    `consentIp` VARCHAR(191) NULL,
    `unsubToken` VARCHAR(191) NOT NULL,
    `unsubscribedAt` DATETIME(3) NULL,
    `bouncedAt` DATETIME(3) NULL,
    `bounceCount` INTEGER NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `MailingContact_unsubToken_key`(`unsubToken`),
    INDEX `MailingContact_tenantId_clientId_idx`(`tenantId`, `clientId`),
    INDEX `MailingContact_tenantId_active_idx`(`tenantId`, `active`),
    UNIQUE INDEX `MailingContact_tenantId_email_key`(`tenantId`, `email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `MailingCampaign` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `subject` VARCHAR(191) NOT NULL,
    `bodyHtml` TEXT NOT NULL,
    `bodyText` TEXT NULL,
    `segment` JSON NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'BROUILLON',
    `testMode` BOOLEAN NOT NULL DEFAULT true,
    `startedAt` DATETIME(3) NULL,
    `finishedAt` DATETIME(3) NULL,
    `sentCount` INTEGER NOT NULL DEFAULT 0,
    `failCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MailingCampaign_tenantId_status_idx`(`tenantId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `MailingDelivery` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `campaignId` VARCHAR(191) NOT NULL,
    `contactId` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'EN_ATTENTE',
    `error` TEXT NULL,
    `sentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MailingDelivery_tenantId_status_idx`(`tenantId`, `status`),
    UNIQUE INDEX `MailingDelivery_campaignId_contactId_key`(`campaignId`, `contactId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `MailingContact` ADD CONSTRAINT `MailingContact_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `MailingContact` ADD CONSTRAINT `MailingContact_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `MailingCampaign` ADD CONSTRAINT `MailingCampaign_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `MailingDelivery` ADD CONSTRAINT `MailingDelivery_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `MailingCampaign`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `MailingDelivery` ADD CONSTRAINT `MailingDelivery_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `MailingContact`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
