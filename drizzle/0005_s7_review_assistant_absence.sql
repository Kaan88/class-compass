ALTER TABLE `assistant_assignments` ADD `absent_student_ids` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `assistant_assignments` ADD `absence_undo` text;