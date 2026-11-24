CREATE TABLE `passkeys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`public_key` text NOT NULL,
	`counter` integer DEFAULT 0 NOT NULL,
	`transports_json` text DEFAULT '[]' NOT NULL,
	`name` text NOT NULL,
	`backed_up` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `passkeys_credential_uq` ON `passkeys` (`credential_id`);--> statement-breakpoint
CREATE INDEX `passkeys_user_idx` ON `passkeys` (`user_id`);--> statement-breakpoint
ALTER TABLE `school_settings` ADD `passwords_off` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `google_sub` text;--> statement-breakpoint
CREATE UNIQUE INDEX `users_google_sub_uq` ON `users` (`google_sub`);