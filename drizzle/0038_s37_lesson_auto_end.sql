PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`student_id` text,
	`subject_id` text,
	`context_id` text,
	`category` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text,
	`count` integer DEFAULT 1 NOT NULL,
	`digested_count` integer DEFAULT 0 NOT NULL,
	`local_date` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`read_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`context_id`) REFERENCES `teaching_contexts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_notifications`("id", "user_id", "student_id", "subject_id", "context_id", "category", "entity", "entity_id", "count", "digested_count", "local_date", "created_at", "updated_at", "read_at") SELECT "id", "user_id", "student_id", "subject_id", "context_id", "category", "entity", "entity_id", "count", "digested_count", "local_date", "created_at", "updated_at", "read_at" FROM `notifications`;--> statement-breakpoint
DROP TABLE `notifications`;--> statement-breakpoint
ALTER TABLE `__new_notifications` RENAME TO `notifications`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `notifications_user_idx` ON `notifications` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `notifications_entity_idx` ON `notifications` (`user_id`,`category`,`entity_id`);--> statement-breakpoint
CREATE INDEX `notifications_student_idx` ON `notifications` (`student_id`);--> statement-breakpoint
CREATE INDEX `notifications_created_idx` ON `notifications` (`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_daily_uq` ON `notifications` (`user_id`,`student_id`,`category`,`local_date`) WHERE category in ('textBlocked', 'speakersPoints');--> statement-breakpoint
ALTER TABLE `lessons` ADD `auto_ended_at` integer;--> statement-breakpoint
ALTER TABLE `lessons` ADD `reminded_at` integer;--> statement-breakpoint
ALTER TABLE `lessons` ADD `auto_end_seen_at` integer;