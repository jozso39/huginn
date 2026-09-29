CREATE TABLE `push_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`label` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_devices_endpoint_unique` ON `push_devices` (`endpoint`);