-- Keep the case-study date label editable with the other public interface copy.
ALTER TABLE site_copy_translations ADD COLUMN project_dates TEXT NOT NULL DEFAULT '';
UPDATE site_copy_translations SET project_dates = CASE locale WHEN 'fr' THEN 'Période' WHEN 'ar' THEN 'الفترة' ELSE 'Dates' END;
