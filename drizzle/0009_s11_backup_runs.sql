CREATE TABLE `backup_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer NOT NULL,
	`file_name` text,
	`size_bytes` integer,
	`app_version` text NOT NULL,
	`migration_level` text NOT NULL,
	`details_json` text,
	`actor_id` text
);
--> statement-breakpoint
CREATE INDEX `backup_runs_kind_idx` ON `backup_runs` (`kind`,`finished_at`);