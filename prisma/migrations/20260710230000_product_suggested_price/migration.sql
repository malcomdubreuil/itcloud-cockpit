-- Prix vendant suggéré modifiable par produit (NULL = défaut PDSF + 2 $/mois)
ALTER TABLE `Product` ADD COLUMN `suggestedPrice` DECIMAL(12, 4) NULL;
