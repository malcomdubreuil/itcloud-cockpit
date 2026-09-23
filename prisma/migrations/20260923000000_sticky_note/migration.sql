-- Post-it du tableau de notes (5e onglet). Table dediee : `Note` existe deja
-- mais porte un clientId obligatoire — c'est une note de fiche client, pas un
-- post-it libre.
CREATE TABLE `StickyNote` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `color` VARCHAR(191) NOT NULL DEFAULT 'JAUNE',
    `x` INTEGER NOT NULL DEFAULT 40,
    `y` INTEGER NOT NULL DEFAULT 40,
    `width` INTEGER NOT NULL DEFAULT 260,
    `height` INTEGER NOT NULL DEFAULT 220,
    `z` INTEGER NOT NULL DEFAULT 0,
    `locked` BOOLEAN NOT NULL DEFAULT false,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `StickyNote_tenantId_deletedAt_idx`(`tenantId`, `deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `StickyNote` ADD CONSTRAINT `StickyNote_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `StickyNote` ADD CONSTRAINT `StickyNote_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
