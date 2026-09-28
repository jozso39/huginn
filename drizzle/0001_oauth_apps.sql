CREATE TABLE `oauth_apps` (
	`provider` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`redirect_mode` text NOT NULL,
	`secret_ciphertext` text NOT NULL,
	`updated_at` integer NOT NULL
);
