CREATE TABLE `classroom_layouts` (
	`user_id` text NOT NULL,
	`scope` text NOT NULL,
	`layout_json` text NOT NULL,
	`version` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `scope`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
