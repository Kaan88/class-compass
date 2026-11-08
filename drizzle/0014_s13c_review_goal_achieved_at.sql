ALTER TABLE `goals` ADD `achieved_at` integer;--> statement-breakpoint
UPDATE `goals` SET `achieved_at` = COALESCE((SELECT MAX(`a`.`at`) FROM `audit_events` `a` WHERE `a`.`entity` = 'goal' AND `a`.`entity_id` = `goals`.`id` AND `a`.`action` = 'goal.update' AND json_extract(`a`.`after_json`, '$.status') = 'achieved'), `created_at`) WHERE `status` = 'achieved';
