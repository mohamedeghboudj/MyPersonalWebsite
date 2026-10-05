ALTER TABLE cv_variant_translations ADD COLUMN profile_heading TEXT NOT NULL DEFAULT 'Profile';
ALTER TABLE cv_variant_translations ADD COLUMN education_heading TEXT NOT NULL DEFAULT 'Education';
ALTER TABLE cv_variant_translations ADD COLUMN present_label TEXT NOT NULL DEFAULT 'Present';
UPDATE cv_variant_translations SET profile_heading = 'Profil', education_heading = 'Formation', present_label = 'Présent' WHERE locale = 'fr';
UPDATE cv_variant_translations SET profile_heading = 'نبذة', education_heading = 'التعليم', present_label = 'حتى الآن' WHERE locale = 'ar';
