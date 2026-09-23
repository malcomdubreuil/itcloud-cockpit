-- Taille du texte, par post-it : un tableau mural se lit de loin, et toutes
-- les notes n'ont pas la meme importance.
ALTER TABLE `StickyNote` ADD COLUMN `fontSize` INTEGER NOT NULL DEFAULT 14;
