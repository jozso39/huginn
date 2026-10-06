CREATE TABLE `connection_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `connection_groups_name_unique` ON `connection_groups` (`name`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `connections` ADD `group_id` text REFERENCES connection_groups(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `connections` ADD `color` text DEFAULT '#64748b' NOT NULL;--> statement-breakpoint
ALTER TABLE `items` ADD `search_text` text;--> statement-breakpoint
-- Categories were free-text group names: one category per distinct name.
INSERT INTO `connection_groups` (`id`, `name`, `created_at`)
SELECT lower(substr(`h`, 1, 8) || '-' || substr(`h`, 9, 4) || '-4' || substr(`h`, 14, 3) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(`h`, 18, 3) || '-' || substr(`h`, 21, 12)), `name`, `created_at`
FROM (
  SELECT hex(randomblob(16)) AS `h`, trim(`group_name`) AS `name`, min(`created_at`) AS `created_at`
  FROM `connections`
  WHERE `group_name` IS NOT NULL AND trim(`group_name`) <> ''
  GROUP BY trim(`group_name`) COLLATE NOCASE
);--> statement-breakpoint
UPDATE `connections` SET `group_id` = (
  SELECT `g`.`id` FROM `connection_groups` AS `g` WHERE `g`.`name` = trim(`connections`.`group_name`) COLLATE NOCASE
) WHERE `group_name` IS NOT NULL AND trim(`group_name`) <> '';--> statement-breakpoint
-- Existing connections get distinct colours from the palette (Connection.utils.ts), oldest first.
UPDATE `connections` SET `color` = (
  SELECT CASE (`r`.`n` - 1) % 12 WHEN 0 THEN '#3b82f6' WHEN 1 THEN '#8b5cf6' WHEN 2 THEN '#14b8a6' WHEN 3 THEN '#f97316' WHEN 4 THEN '#ec4899' WHEN 5 THEN '#22c55e' WHEN 6 THEN '#eab308' WHEN 7 THEN '#06b6d4' WHEN 8 THEN '#ef4444' WHEN 9 THEN '#6366f1' WHEN 10 THEN '#a3a635' WHEN 11 THEN '#64748b' END
  FROM (SELECT `id`, row_number() OVER (ORDER BY `created_at`) AS `n` FROM `connections`) AS `r`
  WHERE `r`.`id` = `connections`.`id`
);
