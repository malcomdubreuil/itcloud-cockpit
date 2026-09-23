-- Titre facultatif sur un post-it : sur un tableau charge, c'est le titre
-- qu'on lit de loin, pas le corps.
ALTER TABLE `StickyNote` ADD COLUMN `title` VARCHAR(191) NULL;
