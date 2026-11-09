CREATE TABLE `report_views` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`viewer` text NOT NULL,
	`name` text NOT NULL,
	`spec_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `report_views_user_idx` ON `report_views` (`user_id`,`viewer`);--> statement-breakpoint
CREATE TABLE `user_settings` (
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `key`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
