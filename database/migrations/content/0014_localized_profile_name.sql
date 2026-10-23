-- An empty translation uses the canonical profile name. Existing content stays unchanged.
ALTER TABLE profile_translations ADD COLUMN localized_name TEXT NOT NULL DEFAULT '' CHECK (length(localized_name) <= 180);
