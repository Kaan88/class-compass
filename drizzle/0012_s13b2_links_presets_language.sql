CREATE TABLE `default_item_archives` (
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`item_id` text NOT NULL,
	`archived_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `kind`, `item_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_student_links` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`token_cipher` text,
	`generation` integer NOT NULL,
	`origin` text DEFAULT 'teacher' NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`revoked_at` integer,
	`revoked_by` text,
	`revoke_kind` text,
	`revoke_reason` text,
	`last_used_at` integer,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revoked_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_student_links`("id", "student_id", "token_hash", "token_cipher", "generation", "origin", "created_by", "created_at", "revoked_at", "revoked_by", "revoke_kind", "revoke_reason", "last_used_at") SELECT "id", "student_id", "token_hash", NULL, "generation", 'teacher', "created_by", "created_at", coalesce("revoked_at", CAST(strftime('%s','now') AS INTEGER) * 1000), "revoked_by", CASE WHEN "revoked_at" IS NULL THEN 'legacy' ELSE 'teacher' END, NULL, "last_used_at" FROM `student_links`;--> statement-breakpoint
UPDATE `sessions` SET `revoked_at` = CAST(strftime('%s','now') AS INTEGER) * 1000 WHERE `kind` = 'student' AND `revoked_at` IS NULL;--> statement-breakpoint
DROP TABLE `student_links`;--> statement-breakpoint
ALTER TABLE `__new_student_links` RENAME TO `student_links`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `student_links_token_uq` ON `student_links` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `student_links_active_uq` ON `student_links` (`student_id`) WHERE revoked_at IS NULL;--> statement-breakpoint
ALTER TABLE `classes` ADD `student_page_main_language` text;--> statement-breakpoint
ALTER TABLE `classes` ADD `student_page_second_language_enabled` integer;