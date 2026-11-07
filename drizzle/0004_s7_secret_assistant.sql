CREATE TABLE `assistant_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`context_id` text NOT NULL,
	`plan_id` text,
	`school_year_id` text NOT NULL,
	`local_date` text NOT NULL,
	`planned_student_id` text,
	`actual_student_id` text,
	`status` text NOT NULL,
	`reason` text,
	`thanked_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`context_id`) REFERENCES `teaching_contexts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`plan_id`) REFERENCES `assistant_plans`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`school_year_id`) REFERENCES `school_years`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`planned_student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actual_student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_assignments_context_date_uq` ON `assistant_assignments` (`context_id`,`local_date`);--> statement-breakpoint
CREATE INDEX `assistant_assignments_year_idx` ON `assistant_assignments` (`context_id`,`school_year_id`);--> statement-breakpoint
CREATE TABLE `assistant_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`context_id` text NOT NULL,
	`week_start` text NOT NULL,
	`generated_at` integer NOT NULL,
	`generated_by` text,
	`announced_at` integer,
	`announced_by` text,
	FOREIGN KEY (`context_id`) REFERENCES `teaching_contexts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`generated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`announced_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_plans_context_week_uq` ON `assistant_plans` (`context_id`,`week_start`);--> statement-breakpoint
CREATE TABLE `assistant_responsibilities` (
	`id` text PRIMARY KEY NOT NULL,
	`context_id` text NOT NULL,
	`label_json` text NOT NULL,
	`sort_order` integer NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`context_id`) REFERENCES `teaching_contexts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `assistant_responsibilities_context_idx` ON `assistant_responsibilities` (`context_id`);--> statement-breakpoint
CREATE TABLE `secret_rounds` (
	`id` text PRIMARY KEY NOT NULL,
	`context_id` text NOT NULL,
	`lesson_id` text NOT NULL,
	`school_year_id` text NOT NULL,
	`local_date` text NOT NULL,
	`status` text NOT NULL,
	`requested_count` integer NOT NULL,
	`selected_count` integer NOT NULL,
	`shortfall_reason` text,
	`drawn_at` integer NOT NULL,
	`drawn_by` text NOT NULL,
	`revealed_at` integer,
	`withdrawn_at` integer,
	`op_id` text NOT NULL,
	FOREIGN KEY (`context_id`) REFERENCES `teaching_contexts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`school_year_id`) REFERENCES `school_years`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`drawn_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `secret_rounds_live_uq` ON `secret_rounds` (`lesson_id`) WHERE status = 'live';--> statement-breakpoint
CREATE INDEX `secret_rounds_context_idx` ON `secret_rounds` (`context_id`,`school_year_id`);--> statement-breakpoint
CREATE TABLE `secret_selections` (
	`id` text PRIMARY KEY NOT NULL,
	`round_id` text NOT NULL,
	`context_id` text NOT NULL,
	`student_id` text NOT NULL,
	`status` text NOT NULL,
	`replaced_selection_id` text,
	`outcome` text,
	`note` text,
	`celebration` integer DEFAULT false NOT NULL,
	`selected_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`outcome_by` text,
	FOREIGN KEY (`round_id`) REFERENCES `secret_rounds`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`context_id`) REFERENCES `teaching_contexts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`outcome_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `secret_selections_round_student_uq` ON `secret_selections` (`round_id`,`student_id`);--> statement-breakpoint
CREATE INDEX `secret_selections_context_student_idx` ON `secret_selections` (`context_id`,`student_id`);