-- Domaine principal d'un client : son site, quand il n'en a qu'un.
ALTER TABLE `Client` ADD COLUMN `mainDomainId` VARCHAR(191) NULL;

CREATE INDEX `Client_mainDomainId_idx` ON `Client`(`mainDomainId`);

ALTER TABLE `Client` ADD CONSTRAINT `Client_mainDomainId_fkey`
    FOREIGN KEY (`mainDomainId`) REFERENCES `Domain`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
