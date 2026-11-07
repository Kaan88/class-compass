CREATE TABLE `group_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`context_id` text NOT NULL,
	`name` text NOT NULL,
	`mode` text NOT NULL,
	`sizing_json` text NOT NULL,
	`seed` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`groups_json` text NOT NULL,
	`unsatisfied_json` text NOT NULL,
	`default_key` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`created_by` text,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`context_id`) REFERENCES `teaching_contexts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `group_templates_context_idx` ON `group_templates` (`context_id`);--> statement-breakpoint
CREATE TABLE `homework_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`context_id` text NOT NULL,
	`title` text NOT NULL,
	`details` text,
	`assigned_on` text NOT NULL,
	`due_on` text NOT NULL,
	`notes` text,
	`status_set_json` text NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`created_by` text,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`context_id`) REFERENCES `teaching_contexts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `homework_context_due_idx` ON `homework_assignments` (`context_id`,`due_on`);--> statement-breakpoint
CREATE INDEX `homework_context_assigned_idx` ON `homework_assignments` (`context_id`,`assigned_on`);--> statement-breakpoint
CREATE TABLE `homework_mark_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`assignment_id` text NOT NULL,
	`student_id` text NOT NULL,
	`before_status` text,
	`before_note` text,
	`after_status` text,
	`after_note` text,
	`changed_at` integer NOT NULL,
	`changed_by` text NOT NULL,
	`undone_at` integer,
	`undone_by` text,
	FOREIGN KEY (`assignment_id`) REFERENCES `homework_assignments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`changed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`undone_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `homework_mark_changes_batch_idx` ON `homework_mark_changes` (`batch_id`);--> statement-breakpoint
CREATE INDEX `homework_mark_changes_assignment_idx` ON `homework_mark_changes` (`assignment_id`,`student_id`);--> statement-breakpoint
CREATE TABLE `homework_marks` (
	`assignment_id` text NOT NULL,
	`student_id` text NOT NULL,
	`status` text NOT NULL,
	`note` text,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`assignment_id`, `student_id`),
	FOREIGN KEY (`assignment_id`) REFERENCES `homework_assignments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `lesson_groupings` (
	`id` text PRIMARY KEY NOT NULL,
	`lesson_id` text NOT NULL,
	`context_id` text NOT NULL,
	`template_id` text NOT NULL,
	`template_version` integer NOT NULL,
	`effective_groups_json` text NOT NULL,
	`excluded_absent_ids` text NOT NULL,
	`unsatisfied_json` text NOT NULL,
	`applied_at` integer NOT NULL,
	`applied_by` text NOT NULL,
	`cleared_at` integer,
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`context_id`) REFERENCES `teaching_contexts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`template_id`) REFERENCES `group_templates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`applied_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lesson_groupings_live_uq` ON `lesson_groupings` (`lesson_id`) WHERE cleared_at IS NULL;--> statement-breakpoint
CREATE INDEX `lesson_groupings_context_idx` ON `lesson_groupings` (`context_id`);--> statement-breakpoint
CREATE TABLE `pair_constraints` (
	`id` text PRIMARY KEY NOT NULL,
	`context_id` text NOT NULL,
	`student_a` text NOT NULL,
	`student_b` text NOT NULL,
	`kind` text NOT NULL,
	`note` text,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`created_by` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`context_id`) REFERENCES `teaching_contexts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_a`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_b`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pair_constraints_live_uq` ON `pair_constraints` (`context_id`,`student_a`,`student_b`) WHERE archived_at IS NULL;