ALTER TABLE `users` ADD `sso_sub` text;--> statement-breakpoint
CREATE UNIQUE INDEX `users_sso_sub_uq` ON `users` (`sso_sub`);