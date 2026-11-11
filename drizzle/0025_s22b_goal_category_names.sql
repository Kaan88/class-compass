CREATE TABLE `goal_category_names` (
	`user_id` text NOT NULL,
	`subject_id` text NOT NULL,
	`category_id` text NOT NULL,
	`name` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `subject_id`, `category_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `skill_categories`(`id`) ON UPDATE no action ON DELETE no action
);
