CREATE TABLE `assistant_chats` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`title` text NOT NULL,
	`title_set` integer DEFAULT false NOT NULL,
	`connection_id` text,
	`model` text,
	`summary` text,
	`summary_seq` integer DEFAULT 0 NOT NULL,
	`next_seq` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_message_at` integer NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `assistant_chats_owner_idx` ON `assistant_chats` (`owner_user_id`,`last_message_at`);--> statement-breakpoint
CREATE INDEX `assistant_chats_last_idx` ON `assistant_chats` (`last_message_at`);--> statement-breakpoint
CREATE TABLE `assistant_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`seq` integer NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`tool_calls_json` text,
	`tool_call_id` text,
	`tool_name` text,
	`is_error` integer DEFAULT false NOT NULL,
	`untrusted` integer DEFAULT false NOT NULL,
	`privacy` text NOT NULL,
	`status` text DEFAULT 'complete' NOT NULL,
	`error_code` text,
	`connection_id` text,
	`model` text,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `assistant_chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_messages_seq_uq` ON `assistant_messages` (`chat_id`,`seq`);--> statement-breakpoint
CREATE TABLE `assistant_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`retention_days` integer DEFAULT 365 NOT NULL,
	`updated_at` integer NOT NULL
);
