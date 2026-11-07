CREATE TABLE `attendance_daily` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`class_id` text NOT NULL,
	`local_date` text NOT NULL,
	`status` text NOT NULL,
	`note` text,
	`recorded_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attendance_daily_student_date_uq` ON `attendance_daily` (`student_id`,`local_date`);--> statement-breakpoint
CREATE INDEX `attendance_daily_class_date_idx` ON `attendance_daily` (`class_id`,`local_date`);--> statement-breakpoint
CREATE TABLE `attendance_lesson_exceptions` (
	`lesson_id` text NOT NULL,
	`student_id` text NOT NULL,
	`status` text NOT NULL,
	`note` text,
	`recorded_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`lesson_id`, `student_id`),
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `context_lesson_settings` (
	`context_id` text PRIMARY KEY NOT NULL,
	`default_template_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`context_id`) REFERENCES `teaching_contexts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `lessons` (
	`id` text PRIMARY KEY NOT NULL,
	`context_id` text NOT NULL,
	`teacher_id` text NOT NULL,
	`class_id` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`local_date` text NOT NULL,
	`routine_template_id` text,
	`routine_name_json` text NOT NULL,
	`routine_snapshot_json` text NOT NULL,
	`stage_index` integer DEFAULT 0 NOT NULL,
	`timer_json` text NOT NULL,
	`reflection_json` text,
	`version` integer DEFAULT 1 NOT NULL,
	`class_name_snapshot` text NOT NULL,
	`subject_name_snapshot` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`context_id`) REFERENCES `teaching_contexts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`teacher_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lessons_one_active_uq` ON `lessons` (`context_id`) WHERE status = 'active';--> statement-breakpoint
CREATE INDEX `lessons_context_idx` ON `lessons` (`context_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `lessons_class_date_idx` ON `lessons` (`class_id`,`local_date`);--> statement-breakpoint
CREATE TABLE `routine_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`teacher_id` text NOT NULL,
	`context_id` text,
	`name` text NOT NULL,
	`stages_json` text NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`teacher_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`context_id`) REFERENCES `teaching_contexts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `routine_templates_teacher_idx` ON `routine_templates` (`teacher_id`);