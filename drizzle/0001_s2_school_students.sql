CREATE TABLE `classes` (
	`id` text PRIMARY KEY NOT NULL,
	`school_year_id` text NOT NULL,
	`name` text NOT NULL,
	`grade` integer,
	`theme` text DEFAULT 'classroom' NOT NULL,
	`timezone` text,
	`sounds_enabled` integer DEFAULT true NOT NULL,
	`animations_enabled` integer DEFAULT true NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`school_year_id`) REFERENCES `school_years`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `classes_year_idx` ON `classes` (`school_year_id`);--> statement-breakpoint
CREATE TABLE `context_modules` (
	`context_id` text NOT NULL,
	`module` text NOT NULL,
	`enabled` integer NOT NULL,
	`config_json` text,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	PRIMARY KEY(`context_id`, `module`),
	FOREIGN KEY (`context_id`) REFERENCES `teaching_contexts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `enrolments` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`class_id` text NOT NULL,
	`school_year_id` text NOT NULL,
	`from_date` text NOT NULL,
	`to_date` text,
	`reason` text NOT NULL,
	`import_batch_id` text,
	`created_at` integer NOT NULL,
	`created_by` text,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`school_year_id`) REFERENCES `school_years`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `enrolments_open_uq` ON `enrolments` (`student_id`,`school_year_id`) WHERE to_date IS NULL;--> statement-breakpoint
CREATE INDEX `enrolments_class_idx` ON `enrolments` (`class_id`);--> statement-breakpoint
CREATE INDEX `enrolments_student_idx` ON `enrolments` (`student_id`);--> statement-breakpoint
CREATE TABLE `module_policies` (
	`module` text PRIMARY KEY NOT NULL,
	`availability` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text
);
--> statement-breakpoint
CREATE TABLE `school_years` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`starts_on` text NOT NULL,
	`ends_on` text NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `student_subject_levels` (
	`student_id` text NOT NULL,
	`subject_id` text NOT NULL,
	`level` text NOT NULL,
	`updated_by` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`student_id`, `subject_id`),
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `students` (
	`id` text PRIMARY KEY NOT NULL,
	`student_number` text,
	`full_name` text NOT NULL,
	`given_names` text,
	`family_name` text,
	`name_fold` text NOT NULL,
	`avatar_hue` integer NOT NULL,
	`photo_file_id` text,
	`photo_consent` integer DEFAULT false NOT NULL,
	`deactivated_at` integer,
	`created_by_import_batch_id` text,
	`created_at` integer NOT NULL,
	`created_by` text,
	`updated_at` integer NOT NULL,
	`updated_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `students_number_uq` ON `students` (`student_number`);--> statement-breakpoint
CREATE INDEX `students_fold_idx` ON `students` (`name_fold`);--> statement-breakpoint
CREATE TABLE `subjects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `teaching_contexts` (
	`id` text PRIMARY KEY NOT NULL,
	`teacher_id` text NOT NULL,
	`class_id` text NOT NULL,
	`subject_id` text NOT NULL,
	`active_from` integer NOT NULL,
	`ended_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`teacher_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teaching_contexts_active_uq` ON `teaching_contexts` (`teacher_id`,`class_id`,`subject_id`) WHERE ended_at IS NULL;--> statement-breakpoint
CREATE INDEX `teaching_contexts_class_idx` ON `teaching_contexts` (`class_id`);--> statement-breakpoint
CREATE INDEX `teaching_contexts_teacher_idx` ON `teaching_contexts` (`teacher_id`);--> statement-breakpoint
CREATE TABLE `terms` (
	`id` text PRIMARY KEY NOT NULL,
	`school_year_id` text NOT NULL,
	`name` text NOT NULL,
	`starts_on` text NOT NULL,
	`ends_on` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`school_year_id`) REFERENCES `school_years`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `terms_year_idx` ON `terms` (`school_year_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `one_time_tokens_hash_uq` ON `one_time_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `one_time_tokens_user_idx` ON `one_time_tokens` (`user_id`);