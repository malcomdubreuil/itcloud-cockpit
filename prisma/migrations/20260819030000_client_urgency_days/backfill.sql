-- Reprise des seuils déjà réglés sur les services : le client prend le seuil
-- le plus élevé parmi ses services (si un service était à 45, le client passe à 45)
UPDATE `Client` c
  JOIN (
    SELECT clientId, MAX(urgencyDays) AS maxDays
    FROM `ClientService`
    WHERE deletedAt IS NULL
    GROUP BY clientId
  ) s ON s.clientId = c.id
SET c.urgencyDays = s.maxDays
WHERE s.maxDays IN (30, 45, 60);
