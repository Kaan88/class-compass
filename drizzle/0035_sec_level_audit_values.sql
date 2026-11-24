-- The audit entry of a level change no longer holds the level (D-211): it says who changed a level,
-- for which student and subject, and when. Past entries lose the old and the new value too.
UPDATE `audit_events` SET `before_json` = json_remove(`before_json`, '$.level'), `after_json` = json_remove(`after_json`, '$.level') WHERE `action` = 'student.level_set';
