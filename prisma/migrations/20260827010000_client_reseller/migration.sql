-- Revendeur : Keven heberge pour lui et lui envoie UNE facture couvrant tous
-- les sites de ses propres clients. Il reste un client (c'est lui qu'on
-- facture), mais sa fiche groupe ses services par domaine.
ALTER TABLE `Client` ADD COLUMN `isReseller` BOOLEAN NOT NULL DEFAULT false;

-- Les deux revendeurs evidents : 147 et 72 services d'hebergement.
UPDATE `Client` SET `isReseller` = true
 WHERE `companyName` IN ('Pclogic Inc.', 'Acxzon');
