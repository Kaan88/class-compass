ALTER TABLE `counter_lesson_resets` ADD `bar_value_before` integer;--> statement-breakpoint
ALTER TABLE `counter_lesson_resets` ADD `cleared_crossing_id` text;--> statement-breakpoint
ALTER TABLE `counter_lesson_resets` ADD `undone_at` integer;--> statement-breakpoint
ALTER TABLE `counter_lesson_resets` ADD `undone_by` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `counter_lesson_resets` ADD `undo_op_id` text;