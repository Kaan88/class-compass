CREATE TABLE `avatar_pictures` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`status` text NOT NULL,
	`quarantine_key` text,
	`file_id` text,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	`decided_at` integer,
	`decided_by` text,
	`refusal_reason` text,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `avatar_pictures_student_idx` ON `avatar_pictures` (`student_id`);--> statement-breakpoint
CREATE INDEX `avatar_pictures_status_idx` ON `avatar_pictures` (`status`,`expires_at`);--> statement-breakpoint
ALTER TABLE `classes` ADD `avatar_uploads` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `super_speakers_settings` ADD `show_own_pictures` integer DEFAULT false NOT NULL;