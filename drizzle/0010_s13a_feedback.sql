CREATE TABLE `assistant_duty_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`context_id` text NOT NULL,
	`local_date` text NOT NULL,
	`student_id` text NOT NULL,
	`responsibility_id` text NOT NULL,
	`checked_at` integer NOT NULL,
	`checked_by` text NOT NULL,
	`unchecked_at` integer,
	FOREIGN KEY (`context_id`) REFERENCES `teaching_contexts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`responsibility_id`) REFERENCES `assistant_responsibilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`checked_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_duty_checks_uq` ON `assistant_duty_checks` (`context_id`,`local_date`,`student_id`,`responsibility_id`);--> statement-breakpoint
CREATE INDEX `assistant_duty_checks_date_idx` ON `assistant_duty_checks` (`context_id`,`local_date`);--> statement-breakpoint
ALTER TABLE `classes` ADD `main_language` text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE `classes` ADD `second_language_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `context_lesson_settings` ADD `topic_plan_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `group_templates` ADD `icon` text;--> statement-breakpoint
ALTER TABLE `lessons` ADD `topics_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `lessons` ADD `display_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `skill_categories` ADD `icon` text;