-- Le site qui donne son titre à son groupe de facturation.
ALTER TABLE `Domain` ADD COLUMN `principal` BOOLEAN NOT NULL DEFAULT false;
