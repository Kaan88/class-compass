CREATE TABLE `mcp_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`at` integer NOT NULL,
	`token_id` text NOT NULL,
	`user_id` text NOT NULL,
	`method` text NOT NULL,
	`status` text NOT NULL,
	`error_code` text,
	`duration_ms` integer NOT NULL,
	`bytes` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mcp_calls_at_idx` ON `mcp_calls` (`at`);--> statement-breakpoint
CREATE INDEX `mcp_calls_token_idx` ON `mcp_calls` (`token_id`,`at`);--> statement-breakpoint
CREATE TABLE `mcp_pseudonyms` (
	`family_id` text NOT NULL,
	`student_id` text NOT NULL,
	`number` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`family_id`, `student_id`),
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_pseudonyms_number_uq` ON `mcp_pseudonyms` (`family_id`,`number`);--> statement-breakpoint
CREATE INDEX `mcp_pseudonyms_student_idx` ON `mcp_pseudonyms` (`student_id`);--> statement-breakpoint
CREATE TABLE `mcp_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`family_id` text NOT NULL,
	`client_id` text,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`prefix` text NOT NULL,
	`scopes_json` text NOT NULL,
	`privacy_mode` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	`revoked_by` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_tokens_hash_uq` ON `mcp_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `mcp_tokens_user_idx` ON `mcp_tokens` (`user_id`);--> statement-breakpoint
CREATE INDEX `mcp_tokens_family_idx` ON `mcp_tokens` (`family_id`);--> statement-breakpoint
ALTER TABLE `audit_events` ADD `via_token_id` text;--> statement-breakpoint
ALTER TABLE `school_settings` ADD `mcp_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `school_settings` ADD `ai_student_data_allowed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `school_settings` ADD `mcp_token_max_days` integer DEFAULT 90 NOT NULL;