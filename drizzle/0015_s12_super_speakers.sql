CREATE TABLE `display_links` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`token_hash` text NOT NULL,
	`token_cipher` text,
	`generation` integer DEFAULT 1 NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`revoked_at` integer,
	`revoked_by` text,
	`last_used_at` integer,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revoked_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `display_links_token_uq` ON `display_links` (`token_hash`);--> statement-breakpoint
CREATE TABLE `point_events` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`scorer_link_id` text NOT NULL,
	`user_id` text,
	`occurred_at` integer NOT NULL,
	`local_date` text NOT NULL,
	`week_start` text NOT NULL,
	`class_id_snapshot` text NOT NULL,
	`class_name_snapshot` text NOT NULL,
	`voided_at` integer,
	`voided_by` text,
	`void_reason` text,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`scorer_link_id`) REFERENCES `scorer_links`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`class_id_snapshot`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `point_events_date_idx` ON `point_events` (`local_date`);--> statement-breakpoint
CREATE INDEX `point_events_student_idx` ON `point_events` (`student_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `point_events_scorer_idx` ON `point_events` (`scorer_link_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `scorer_links` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`locale` text DEFAULT 'en' NOT NULL,
	`user_id` text,
	`token_hash` text NOT NULL,
	`token_cipher` text,
	`generation` integer DEFAULT 1 NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`revoked_at` integer,
	`revoked_by` text,
	`last_used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revoked_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scorer_links_token_uq` ON `scorer_links` (`token_hash`);--> statement-breakpoint
CREATE TABLE `scorer_pairings` (
	`id` text PRIMARY KEY NOT NULL,
	`scorer_link_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	FOREIGN KEY (`scorer_link_id`) REFERENCES `scorer_links`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `scorer_pairings_code_idx` ON `scorer_pairings` (`code_hash`);--> statement-breakpoint
CREATE INDEX `scorer_pairings_link_idx` ON `scorer_pairings` (`scorer_link_id`);--> statement-breakpoint
CREATE TABLE `super_speakers_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`week_starts_on` integer DEFAULT 1 NOT NULL,
	`participating_class_ids` text,
	`undo_window_minutes` integer DEFAULT 10 NOT NULL,
	`rate_limit_max` integer DEFAULT 60 NOT NULL,
	`rate_limit_window_minutes` integer DEFAULT 10 NOT NULL,
	`board_title` text NOT NULL,
	`board_language` text DEFAULT 'en' NOT NULL,
	`theme` text DEFAULT 'explorer' NOT NULL,
	`board_sound` integer DEFAULT false NOT NULL,
	`badge_subject_id` text,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`badge_subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `sessions` ADD `scorer_link_id` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `display_link_id` text;--> statement-breakpoint
CREATE INDEX `sessions_scorer_link_idx` ON `sessions` (`scorer_link_id`);--> statement-breakpoint
CREATE INDEX `sessions_display_link_idx` ON `sessions` (`display_link_id`);