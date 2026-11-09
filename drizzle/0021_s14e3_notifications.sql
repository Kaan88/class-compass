CREATE TABLE `notification_digests` (
	`user_id` text NOT NULL,
	`local_date` text NOT NULL,
	`sent_at` integer NOT NULL,
	`status` text NOT NULL,
	`items_json` text NOT NULL,
	PRIMARY KEY(`user_id`, `local_date`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`student_id` text NOT NULL,
	`subject_id` text,
	`context_id` text,
	`category` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text,
	`count` integer DEFAULT 1 NOT NULL,
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
CREATE INDEX `notifications_user_idx` ON `notifications` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `notifications_entity_idx` ON `notifications` (`user_id`,`category`,`entity_id`);--> statement-breakpoint
CREATE INDEX `notifications_student_idx` ON `notifications` (`student_id`);--> statement-breakpoint
CREATE INDEX `notifications_created_idx` ON `notifications` (`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_daily_uq` ON `notifications` (`user_id`,`student_id`,`category`,`local_date`) WHERE category in ('textBlocked', 'speakersPoints');