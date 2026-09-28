-- Youth academies start independently of imported first-team training levels.
UPDATE teams
SET facilities = json_set(facilities, '$.youth', 1)
WHERE json_valid(facilities) AND json_type(facilities, '$.youth') IS NULL;
