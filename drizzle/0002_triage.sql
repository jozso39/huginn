CREATE TABLE `rule_history` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`change` text NOT NULL,
	`origin` text NOT NULL,
	`before` text,
	`after` text,
	`reason` text,
	`item_id` text,
	`checks` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `rule_history_connection` ON `rule_history` (`connection_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `rules` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`name` text NOT NULL,
	`verdict` text NOT NULL,
	`kind` text NOT NULL,
	`predicate` text,
	`criterion` text,
	`threshold` real NOT NULL,
	`priority` integer NOT NULL,
	`status` text NOT NULL,
	`origin` text NOT NULL,
	`hits` integer DEFAULT 0 NOT NULL,
	`last_hit_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `rules_connection_priority` ON `rules` (`connection_id`,`priority`);--> statement-breakpoint
ALTER TABLE `connections` ADD `group_name` text;--> statement-breakpoint
ALTER TABLE `items` ADD `decision` text;