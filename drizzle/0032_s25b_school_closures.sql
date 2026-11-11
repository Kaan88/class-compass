CREATE TABLE `school_closures` (
	`id` text PRIMARY KEY NOT NULL,
	`school_year_id` text NOT NULL,
	`name` text NOT NULL,
	`starts_on` text NOT NULL,
	`ends_on` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`school_year_id`) REFERENCES `school_years`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `school_closures_year_idx` ON `school_closures` (`school_year_id`,`starts_on`);