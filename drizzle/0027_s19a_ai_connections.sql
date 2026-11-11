CREATE TABLE `ai_connection_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`default_connection_id` text,
	`default_model` text,
	`teacher_connections_allowed` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ai_connection_usage` (
	`connection_id` text NOT NULL,
	`user_id` text NOT NULL,
	`local_date` text NOT NULL,
	`messages` integer DEFAULT 0 NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`connection_id`, `user_id`, `local_date`),
	FOREIGN KEY (`connection_id`) REFERENCES `ai_connections`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ai_connection_usage_date_idx` ON `ai_connection_usage` (`connection_id`,`local_date`);--> statement-breakpoint
CREATE TABLE `ai_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`base_url` text,
	`local_network` integer DEFAULT false NOT NULL,
	`models_json` text NOT NULL,
	`secret_cipher` text,
	`secret_set_at` integer,
	`secret_source` text,
	`monthly_token_budget` integer,
	`daily_message_limit` integer,
	`enabled` integer DEFAULT true NOT NULL,
	`kvkk_confirmed_at` integer NOT NULL,
	`kvkk_confirmed_by` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ai_connections_owner_idx` ON `ai_connections` (`owner_user_id`);--> statement-breakpoint
CREATE TABLE `ai_oauth_states` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`verifier_cipher` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`connection_id`) REFERENCES `ai_connections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ai_oauth_states_user_idx` ON `ai_oauth_states` (`user_id`);