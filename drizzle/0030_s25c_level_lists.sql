CREATE TABLE `level_lists` (
	`class_id` text NOT NULL,
	`subject_id` text NOT NULL,
	`labels_json` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	PRIMARY KEY(`class_id`, `subject_id`),
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
