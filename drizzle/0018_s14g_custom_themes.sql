CREATE TABLE `custom_themes` (
	`key` text PRIMARY KEY NOT NULL,
	`package_json` text NOT NULL,
	`report_json` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`bytes` integer NOT NULL,
	`created_by` text,
	`updated_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
