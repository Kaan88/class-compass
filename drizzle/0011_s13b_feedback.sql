ALTER TABLE `classes` ADD `sound_volume` integer DEFAULT 80 NOT NULL;--> statement-breakpoint
ALTER TABLE `classes` ADD `quote_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `classes` ADD `time_up_sound` text DEFAULT 'voice' NOT NULL;--> statement-breakpoint
ALTER TABLE `import_batches` ADD `sheets_json` text;--> statement-breakpoint
ALTER TABLE `one_time_tokens` ADD `revoked_at` integer;--> statement-breakpoint
ALTER TABLE `one_time_tokens` ADD `code_hash` text;--> statement-breakpoint
ALTER TABLE `one_time_tokens` ADD `binding_hash` text;--> statement-breakpoint
ALTER TABLE `one_time_tokens` ADD `code_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `one_time_tokens` ADD `sent_by_email` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `one_time_tokens` ADD `created_by` text;--> statement-breakpoint
ALTER TABLE `school_settings` ADD `weather_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `school_settings` ADD `weather_label` text DEFAULT 'Ankara, Kızılay' NOT NULL;--> statement-breakpoint
ALTER TABLE `school_settings` ADD `weather_latitude` real DEFAULT 39.92 NOT NULL;--> statement-breakpoint
ALTER TABLE `school_settings` ADD `weather_longitude` real DEFAULT 32.85 NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `auth_method` text;--> statement-breakpoint
ALTER TABLE `users` ADD `sign_in_method` text DEFAULT 'password' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `email_verified_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `time_up_clip_file_id` text;