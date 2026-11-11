CREATE TABLE `lesson_goals` (
	`lesson_id` text PRIMARY KEY NOT NULL,
	`context_id` text NOT NULL,
	`text` text NOT NULL,
	`outcome` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`reviewed_at` integer,
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`context_id`) REFERENCES `teaching_contexts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `lesson_goals_context_idx` ON `lesson_goals` (`context_id`);