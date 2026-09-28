CREATE TABLE `actions` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`result` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `actions_item` ON `actions` (`item_id`);--> statement-breakpoint
CREATE TABLE `connections` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`config` text NOT NULL,
	`cursor` text NOT NULL,
	`secrets_ciphertext` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`status` text NOT NULL,
	`status_message` text,
	`last_sync_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `items` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`external_id` text NOT NULL,
	`thread_key` text NOT NULL,
	`kind` text NOT NULL,
	`author` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`url` text,
	`received_at` integer NOT NULL,
	`features` text NOT NULL,
	`raw` text NOT NULL,
	`category` text NOT NULL,
	`decided_by_rule_id` text,
	`state` text NOT NULL,
	`state_changed_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `items_connection_external` ON `items` (`connection_id`,`external_id`);--> statement-breakpoint
CREATE INDEX `items_state_received` ON `items` (`state`,`received_at`);--> statement-breakpoint
CREATE INDEX `items_thread` ON `items` (`thread_key`);