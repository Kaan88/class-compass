CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`storage_key` text NOT NULL,
	`thumb_storage_key` text,
	`sha256` text NOT NULL,
	`size` integer NOT NULL,
	`thumb_size` integer,
	`sniffed_mime` text NOT NULL,
	`kind` text NOT NULL,
	`original_name` text,
	`owner_student_id` text,
	`uploaded_by_type` text NOT NULL,
	`uploaded_by_id` text,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`owner_student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `files_storage_key_uq` ON `files` (`storage_key`);--> statement-breakpoint
CREATE INDEX `files_owner_idx` ON `files` (`owner_student_id`);--> statement-breakpoint
CREATE INDEX `files_uploader_idx` ON `files` (`uploaded_by_id`);--> statement-breakpoint
CREATE TABLE `import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`source_type` text NOT NULL,
	`file_id` text,
	`target_class_id` text NOT NULL,
	`school_year_id` text NOT NULL,
	`created_by` text NOT NULL,
	`status` text NOT NULL,
	`columns_json` text NOT NULL,
	`mapping_json` text NOT NULL,
	`notices_json` text NOT NULL,
	`counts_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`committed_at` integer,
	`committed_by` text,
	`reverted_at` integer,
	`reverted_by` text,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`school_year_id`) REFERENCES `school_years`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`committed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reverted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `import_batches_class_idx` ON `import_batches` (`target_class_id`);--> statement-breakpoint
CREATE INDEX `import_batches_creator_idx` ON `import_batches` (`created_by`);--> statement-breakpoint
CREATE TABLE `import_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`idx` integer NOT NULL,
	`raw_json` text NOT NULL,
	`page` integer,
	`parsed_json` text NOT NULL,
	`edited` integer DEFAULT false NOT NULL,
	`ocr_confidence` integer,
	`flags_json` text NOT NULL,
	`candidates_json` text NOT NULL,
	`decision` text NOT NULL,
	`decision_source` text NOT NULL,
	`matched_student_id` text,
	`fill_number` integer DEFAULT false NOT NULL,
	`filled_number` integer DEFAULT false NOT NULL,
	`created_student_id` text,
	`created_enrolment_id` text,
	`outcome` text,
	`reason` text,
	`revert_outcome` text,
	FOREIGN KEY (`batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_rows_batch_idx_uq` ON `import_rows` (`batch_id`,`idx`);