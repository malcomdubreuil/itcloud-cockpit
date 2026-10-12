-- Le JSON chiffre d une connexion (jeton + realm + nom de compagnie) depasse 191
-- caracteres ; en VARCHAR(191) MySQL le tronquait en silence (sql_mode vide), ce
-- qui a rendu les deux connexions QuickBooks indechiffrables le 2026-10-12.
ALTER TABLE `ApiCredential` MODIFY `keyEnc` TEXT NOT NULL;
