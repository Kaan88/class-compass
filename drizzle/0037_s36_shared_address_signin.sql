DROP INDEX `users_google_sub_uq`;--> statement-breakpoint
DROP INDEX `users_sso_sub_uq`;--> statement-breakpoint
CREATE INDEX `users_google_sub_idx` ON `users` (`google_sub`);--> statement-breakpoint
CREATE INDEX `users_sso_sub_idx` ON `users` (`sso_sub`);