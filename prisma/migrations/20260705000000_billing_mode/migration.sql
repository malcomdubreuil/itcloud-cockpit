-- Mode de facturation ITCloud (Direct = ITCloud facture le client, rien à refacturer)
ALTER TABLE `ClientService`
  ADD COLUMN `billingMode` ENUM('INDIRECT', 'DIRECT') NOT NULL DEFAULT 'INDIRECT';
