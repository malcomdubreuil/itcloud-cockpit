-- Aide à la refacturation : derniers numéros de facture par service
ALTER TABLE `ClientService`
  ADD COLUMN `lastQbInvoiceNo` VARCHAR(191) NULL,
  ADD COLUMN `lastItcloudInvoiceNo` VARCHAR(191) NULL;
