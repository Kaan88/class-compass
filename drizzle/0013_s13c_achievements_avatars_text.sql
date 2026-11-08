CREATE TABLE `achievement_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`icon` text NOT NULL,
	`tier` text NOT NULL,
	`category` text NOT NULL,
	`kind` text NOT NULL,
	`rule_json` text,
	`subject_id` text,
	`created_by` text,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `achievement_definitions_key_uq` ON `achievement_definitions` (`key`);--> statement-breakpoint
CREATE INDEX `achievement_definitions_creator_idx` ON `achievement_definitions` (`created_by`);--> statement-breakpoint
CREATE TABLE `student_achievements` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`achievement_id` text NOT NULL,
	`context_id` text,
	`lesson_id` text,
	`awarded_at` integer NOT NULL,
	`awarded_by` text,
	`source` text NOT NULL,
	`source_ref` text,
	`name_snapshot` text NOT NULL,
	`icon_snapshot` text NOT NULL,
	`tier_snapshot` text NOT NULL,
	`quiet` integer DEFAULT false NOT NULL,
	`seen_at` integer,
	`revoked_at` integer,
	`revoked_by` text,
	`revoke_reason` text,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`achievement_id`) REFERENCES `achievement_definitions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`context_id`) REFERENCES `teaching_contexts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`awarded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revoked_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `student_achievements_live_uq` ON `student_achievements` (`student_id`,`achievement_id`,`context_id`) WHERE revoked_at IS NULL;--> statement-breakpoint
CREATE INDEX `student_achievements_student_idx` ON `student_achievements` (`student_id`);--> statement-breakpoint
CREATE INDEX `student_achievements_context_idx` ON `student_achievements` (`context_id`,`awarded_at`);--> statement-breakpoint
CREATE TABLE `text_check_attempts` (
	`student_id` text NOT NULL,
	`subject_id` text NOT NULL,
	`local_date` text NOT NULL,
	`count` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`student_id`, `subject_id`, `local_date`),
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `text_check_words` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`owner_id` text DEFAULT '' NOT NULL,
	`list` text NOT NULL,
	`word` text NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `text_check_words_uq` ON `text_check_words` (`scope`,`owner_id`,`list`,`word`);--> statement-breakpoint
ALTER TABLE `classes` ADD `avatars_locked` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `classes` ADD `avatar_fallback` text DEFAULT 'generated' NOT NULL;--> statement-breakpoint
ALTER TABLE `evidence` ADD `hidden_at` integer;--> statement-breakpoint
ALTER TABLE `evidence` ADD `hidden_by` text;--> statement-breakpoint
ALTER TABLE `goal_entries` ADD `hidden_at` integer;--> statement-breakpoint
ALTER TABLE `goal_entries` ADD `hidden_by` text;--> statement-breakpoint
ALTER TABLE `goals` ADD `hidden_at` integer;--> statement-breakpoint
ALTER TABLE `goals` ADD `hidden_by` text;--> statement-breakpoint
ALTER TABLE `school_settings` ADD `text_min_goal_words` integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE `school_settings` ADD `text_min_goal_letters` integer DEFAULT 12 NOT NULL;--> statement-breakpoint
ALTER TABLE `students` ADD `avatar_json` text;--> statement-breakpoint
ALTER TABLE `students` ADD `avatar_updated_at` integer;