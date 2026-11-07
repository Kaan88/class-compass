CREATE TABLE `counter_events` (
	`id` text PRIMARY KEY NOT NULL,
	`counter_id` text NOT NULL,
	`context_id` text NOT NULL,
	`lesson_id` text NOT NULL,
	`student_id` text,
	`seq` integer NOT NULL,
	`occurred_at` integer NOT NULL,
	`local_date` text NOT NULL,
	`week_start` text NOT NULL,
	`recorded_by` text NOT NULL,
	`voided_at` integer,
	`voided_by` text,
	`void_op_id` text,
	`label_snapshot_json` text NOT NULL,
	FOREIGN KEY (`counter_id`) REFERENCES `counters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`context_id`) REFERENCES `teaching_contexts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`voided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `counter_events_lesson_seq_uq` ON `counter_events` (`counter_id`,`lesson_id`,`seq`);--> statement-breakpoint
CREATE INDEX `counter_events_student_week_idx` ON `counter_events` (`counter_id`,`student_id`,`week_start`);--> statement-breakpoint
CREATE INDEX `counter_events_lesson_idx` ON `counter_events` (`lesson_id`);--> statement-breakpoint
CREATE TABLE `counter_lesson_resets` (
	`id` text PRIMARY KEY NOT NULL,
	`counter_id` text NOT NULL,
	`lesson_id` text NOT NULL,
	`after_seq` integer NOT NULL,
	`reset_at` integer NOT NULL,
	`reset_by` text NOT NULL,
	FOREIGN KEY (`counter_id`) REFERENCES `counters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reset_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `counter_lesson_resets_idx` ON `counter_lesson_resets` (`counter_id`,`lesson_id`);--> statement-breakpoint
CREATE TABLE `counters` (
	`id` text PRIMARY KEY NOT NULL,
	`context_id` text NOT NULL,
	`kind` text NOT NULL,
	`labels_json` text NOT NULL,
	`scope` text NOT NULL,
	`bar_segments` integer DEFAULT 10 NOT NULL,
	`student_reset_period` text DEFAULT 'week' NOT NULL,
	`student_thresholds_json` text NOT NULL,
	`responses_json` text NOT NULL,
	`active_response_id` text,
	`colour` text DEFAULT 'accent' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`archived_at` integer,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`context_id`) REFERENCES `teaching_contexts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `counters_context_idx` ON `counters` (`context_id`);--> statement-breakpoint
CREATE TABLE `threshold_crossings` (
	`id` text PRIMARY KEY NOT NULL,
	`counter_id` text NOT NULL,
	`lesson_id` text NOT NULL,
	`crossing_seq` integer NOT NULL,
	`crossed_at` integer NOT NULL,
	`cleared_at` integer,
	`cleared_reason` text,
	`event_id` text NOT NULL,
	`response_id` text,
	FOREIGN KEY (`counter_id`) REFERENCES `counters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `threshold_crossings_seq_uq` ON `threshold_crossings` (`counter_id`,`lesson_id`,`crossing_seq`);