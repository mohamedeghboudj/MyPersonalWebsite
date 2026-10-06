-- Copy every dependent row before replacing the spike identity constraint.
-- D1 executes a migration transactionally. Dropping a referenced parent can
-- cascade even with defer_foreign_keys, so drop children first, then rename.
CREATE TABLE content_items_next (id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('education','experience','achievement','certificate','initiative','skill','project','language')), created_at TEXT NOT NULL DEFAULT (datetime('now')));
INSERT INTO content_items_next(id, kind) SELECT id, kind FROM content_items;
CREATE TABLE education_next (id INTEGER PRIMARY KEY REFERENCES content_items_next(id) ON DELETE CASCADE, start_date TEXT NOT NULL, end_date TEXT, school_url TEXT, display_order INTEGER NOT NULL DEFAULT 0 CHECK(display_order >= 0), is_visible INTEGER NOT NULL DEFAULT 0 CHECK(is_visible IN (0,1)), CHECK(end_date IS NULL OR end_date >= start_date));
INSERT INTO education_next SELECT * FROM education;
CREATE TABLE education_translations_next (education_id INTEGER NOT NULL REFERENCES education_next(id) ON DELETE CASCADE, locale TEXT NOT NULL CHECK(locale IN ('en','fr','ar')), school TEXT NOT NULL, degree TEXT NOT NULL, description TEXT NOT NULL, PRIMARY KEY(education_id, locale));
INSERT INTO education_translations_next SELECT * FROM education_translations;
CREATE TABLE cv_variant_items_next (variant_id INTEGER NOT NULL REFERENCES cv_variants(id) ON DELETE CASCADE, content_item_id INTEGER NOT NULL REFERENCES content_items_next(id) ON DELETE CASCADE, position INTEGER NOT NULL CHECK(position >= 0), section TEXT NOT NULL DEFAULT 'education', is_visible INTEGER NOT NULL DEFAULT 1 CHECK(is_visible IN (0,1)), PRIMARY KEY(variant_id, content_item_id));
INSERT INTO cv_variant_items_next(variant_id, content_item_id, position) SELECT variant_id, content_item_id, position FROM cv_variant_items;
DROP TABLE cv_variant_items;
DROP TABLE education_translations;
DROP TABLE education;
DROP TABLE content_items;
ALTER TABLE content_items_next RENAME TO content_items;
ALTER TABLE education_next RENAME TO education;
ALTER TABLE education_translations_next RENAME TO education_translations;
ALTER TABLE cv_variant_items_next RENAME TO cv_variant_items;
CREATE INDEX content_items_kind ON content_items(kind);
CREATE INDEX education_visibility_order ON education(is_visible, display_order);
CREATE INDEX education_locale ON education_translations(locale);
CREATE INDEX variant_item_content ON cv_variant_items(content_item_id);
CREATE INDEX variant_item_order ON cv_variant_items(variant_id, section, position);
-- An identity's kind is immutable; per-kind insert/update guards are below.
CREATE TRIGGER content_kind_immutable BEFORE UPDATE OF kind ON content_items WHEN NEW.kind <> OLD.kind BEGIN SELECT RAISE(ABORT, 'Content kind is immutable'); END;
CREATE TABLE media (id INTEGER PRIMARY KEY, r2_key TEXT NOT NULL UNIQUE, content_type TEXT NOT NULL CHECK(content_type IN ('image/jpeg','image/png','image/webp','image/avif','application/pdf')), byte_size INTEGER NOT NULL CHECK(byte_size > 0), width INTEGER CHECK(width > 0), height INTEGER CHECK(height > 0), is_public INTEGER NOT NULL DEFAULT 0 CHECK(is_public IN (0,1)), created_at TEXT NOT NULL DEFAULT (datetime('now')), CHECK((width IS NULL) = (height IS NULL)));
CREATE TABLE media_translations (media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE, locale TEXT NOT NULL CHECK(locale IN ('en','fr','ar')), alt_text TEXT NOT NULL, PRIMARY KEY(media_id, locale));
CREATE INDEX media_locale ON media_translations(locale);
ALTER TABLE profile ADD COLUMN portrait_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL;
ALTER TABLE profile ADD COLUMN city TEXT;
ALTER TABLE profile ADD COLUMN country TEXT;
CREATE INDEX profile_portrait ON profile(portrait_media_id);
ALTER TABLE profile_translations ADD COLUMN bio TEXT NOT NULL DEFAULT '';
ALTER TABLE education ADD COLUMN logo_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL;
ALTER TABLE education ADD COLUMN city TEXT;
ALTER TABLE education ADD COLUMN country TEXT;
ALTER TABLE education_translations ADD COLUMN field TEXT NOT NULL DEFAULT '';
ALTER TABLE education_translations ADD COLUMN status TEXT NOT NULL DEFAULT '';
CREATE INDEX education_logo ON education(logo_media_id);
ALTER TABLE cv_variants ADD COLUMN template TEXT NOT NULL DEFAULT 'reference-2';
CREATE TABLE cv_variant_item_translations (variant_id INTEGER NOT NULL, content_item_id INTEGER NOT NULL, locale TEXT NOT NULL CHECK(locale IN ('en','fr','ar')), bullet_override TEXT NOT NULL, PRIMARY KEY(variant_id, content_item_id, locale), FOREIGN KEY(variant_id, content_item_id) REFERENCES cv_variant_items(variant_id, content_item_id) ON DELETE CASCADE);
CREATE INDEX variant_item_locale ON cv_variant_item_translations(locale);
-- The public slot remains stable; edit its content instead of deleting it.
CREATE TRIGGER public_variant_no_delete BEFORE DELETE ON cv_variants WHEN OLD.is_public = 1 BEGIN SELECT RAISE(ABORT, 'The public CV is required'); END;
CREATE TRIGGER public_variant_no_unset BEFORE UPDATE OF is_public ON cv_variants WHEN OLD.is_public = 1 AND NEW.is_public <> 1 BEGIN SELECT RAISE(ABORT, 'The public CV is required'); END;
INSERT INTO cv_variants(slug, template) VALUES ('aviation','reference-2'), ('ai','reference-2'), ('software-engineering-jobs','reference-2'), ('research-universities','reference-2'), ('initiatives-leadership-management','reference-2');
-- Presets deliberately have no invented biography or selection; phase 2 edits them.
CREATE TABLE cv_pdf_cache (cache_key TEXT PRIMARY KEY, variant_id INTEGER NOT NULL REFERENCES cv_variants(id) ON DELETE CASCADE, locale TEXT NOT NULL CHECK(locale IN ('en','fr','ar')), template_version TEXT NOT NULL, content_hash TEXT NOT NULL, object_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT NOT NULL);
CREATE INDEX cv_cache_variant ON cv_pdf_cache(variant_id);
CREATE INDEX cv_cache_expiry ON cv_pdf_cache(expires_at);
ALTER TABLE audit_log ADD COLUMN change_reference TEXT;
CREATE TABLE experience (id INTEGER PRIMARY KEY REFERENCES content_items(id) ON DELETE CASCADE, start_date TEXT NOT NULL, end_date TEXT, organization_url TEXT, logo_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL, city TEXT, country TEXT, display_order INTEGER NOT NULL DEFAULT 0 CHECK(display_order >= 0), is_visible INTEGER NOT NULL DEFAULT 0 CHECK(is_visible IN (0,1)), CHECK(end_date IS NULL OR end_date >= start_date));
CREATE TABLE experience_translations (experience_id INTEGER NOT NULL REFERENCES experience(id) ON DELETE CASCADE, locale TEXT NOT NULL CHECK(locale IN ('en','fr','ar')), organization TEXT NOT NULL, role TEXT NOT NULL, description TEXT NOT NULL, PRIMARY KEY(experience_id, locale));
CREATE TABLE achievements (id INTEGER PRIMARY KEY REFERENCES content_items(id) ON DELETE CASCADE, achieved_on TEXT, verification_url TEXT, media_id INTEGER REFERENCES media(id) ON DELETE SET NULL, display_order INTEGER NOT NULL DEFAULT 0 CHECK(display_order >= 0), is_visible INTEGER NOT NULL DEFAULT 0 CHECK(is_visible IN (0,1)));
CREATE TABLE achievement_translations (achievement_id INTEGER NOT NULL REFERENCES achievements(id) ON DELETE CASCADE, locale TEXT NOT NULL CHECK(locale IN ('en','fr','ar')), title TEXT NOT NULL, issuer TEXT NOT NULL, description TEXT NOT NULL, PRIMARY KEY(achievement_id, locale));
CREATE TABLE certificates (id INTEGER PRIMARY KEY REFERENCES content_items(id) ON DELETE CASCADE, issued_on TEXT, expires_on TEXT, verification_url TEXT, original_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL, public_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL, display_order INTEGER NOT NULL DEFAULT 0 CHECK(display_order >= 0), is_visible INTEGER NOT NULL DEFAULT 0 CHECK(is_visible IN (0,1)), CHECK(expires_on IS NULL OR issued_on IS NULL OR expires_on >= issued_on));
CREATE TABLE certificate_translations (certificate_id INTEGER NOT NULL REFERENCES certificates(id) ON DELETE CASCADE, locale TEXT NOT NULL CHECK(locale IN ('en','fr','ar')), title TEXT NOT NULL, issuer TEXT NOT NULL, description TEXT NOT NULL, PRIMARY KEY(certificate_id, locale));
CREATE TABLE initiatives (id INTEGER PRIMARY KEY REFERENCES content_items(id) ON DELETE CASCADE, start_date TEXT NOT NULL, end_date TEXT, website_url TEXT, media_id INTEGER REFERENCES media(id) ON DELETE SET NULL, display_order INTEGER NOT NULL DEFAULT 0 CHECK(display_order >= 0), is_visible INTEGER NOT NULL DEFAULT 0 CHECK(is_visible IN (0,1)), CHECK(end_date IS NULL OR end_date >= start_date));
CREATE TABLE initiative_translations (initiative_id INTEGER NOT NULL REFERENCES initiatives(id) ON DELETE CASCADE, locale TEXT NOT NULL CHECK(locale IN ('en','fr','ar')), title TEXT NOT NULL, role TEXT NOT NULL, description TEXT NOT NULL, PRIMARY KEY(initiative_id, locale));
CREATE TABLE skills (id INTEGER PRIMARY KEY REFERENCES content_items(id) ON DELETE CASCADE, display_order INTEGER NOT NULL DEFAULT 0 CHECK(display_order >= 0), is_visible INTEGER NOT NULL DEFAULT 0 CHECK(is_visible IN (0,1)));
CREATE TABLE skill_translations (skill_id INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE, locale TEXT NOT NULL CHECK(locale IN ('en','fr','ar')), name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', PRIMARY KEY(skill_id, locale));
CREATE TABLE languages (id INTEGER PRIMARY KEY REFERENCES content_items(id) ON DELETE CASCADE, language_code TEXT NOT NULL UNIQUE, display_order INTEGER NOT NULL DEFAULT 0 CHECK(display_order >= 0), is_visible INTEGER NOT NULL DEFAULT 0 CHECK(is_visible IN (0,1)));
CREATE TABLE language_translations (language_id INTEGER NOT NULL REFERENCES languages(id) ON DELETE CASCADE, locale TEXT NOT NULL CHECK(locale IN ('en','fr','ar')), name TEXT NOT NULL, proficiency TEXT NOT NULL, PRIMARY KEY(language_id, locale));
CREATE TABLE project_categories (id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, display_order INTEGER NOT NULL DEFAULT 0 CHECK(display_order >= 0), is_visible INTEGER NOT NULL DEFAULT 0 CHECK(is_visible IN (0,1)));
CREATE TABLE project_category_translations (category_id INTEGER NOT NULL REFERENCES project_categories(id) ON DELETE CASCADE, locale TEXT NOT NULL CHECK(locale IN ('en','fr','ar')), name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', PRIMARY KEY(category_id, locale));
CREATE TABLE projects (id INTEGER PRIMARY KEY REFERENCES content_items(id) ON DELETE CASCADE, slug TEXT NOT NULL UNIQUE, start_date TEXT, end_date TEXT, cover_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL, is_featured INTEGER NOT NULL DEFAULT 0 CHECK(is_featured IN (0,1)), display_order INTEGER NOT NULL DEFAULT 0 CHECK(display_order >= 0), is_visible INTEGER NOT NULL DEFAULT 0 CHECK(is_visible IN (0,1)), CHECK(end_date IS NULL OR start_date IS NULL OR end_date >= start_date));
CREATE TABLE project_translations (project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, locale TEXT NOT NULL CHECK(locale IN ('en','fr','ar')), title TEXT NOT NULL, summary TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', PRIMARY KEY(project_id, locale));
CREATE TABLE project_images (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, media_id INTEGER NOT NULL REFERENCES media(id), position INTEGER NOT NULL CHECK(position >= 0), UNIQUE(project_id, media_id));
-- R2 keys and localized alt text belong to media, not duplicated in each gallery.
CREATE TABLE project_image_translations (image_id INTEGER NOT NULL REFERENCES project_images(id) ON DELETE CASCADE, locale TEXT NOT NULL CHECK(locale IN ('en','fr','ar')), caption TEXT NOT NULL, PRIMARY KEY(image_id, locale));
CREATE TABLE project_links (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, kind TEXT NOT NULL CHECK(kind IN ('repo','demo','other')), url TEXT NOT NULL, position INTEGER NOT NULL CHECK(position >= 0));
CREATE TABLE project_link_translations (link_id INTEGER NOT NULL REFERENCES project_links(id) ON DELETE CASCADE, locale TEXT NOT NULL CHECK(locale IN ('en','fr','ar')), label TEXT NOT NULL, PRIMARY KEY(link_id, locale));
CREATE TABLE technologies (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, slug TEXT NOT NULL UNIQUE);
CREATE TABLE project_technologies (project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, technology_id INTEGER NOT NULL REFERENCES technologies(id), PRIMARY KEY(project_id, technology_id));
CREATE INDEX project_technology_reverse ON project_technologies(technology_id);
CREATE TABLE project_category_map (project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, category_id INTEGER NOT NULL REFERENCES project_categories(id), PRIMARY KEY(project_id, category_id));
CREATE INDEX project_category_reverse ON project_category_map(category_id);
-- Writing exists from day one; editing/publishing UI comes in the content phase.
CREATE TABLE articles (id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, published_on TEXT, cover_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL, display_order INTEGER NOT NULL DEFAULT 0 CHECK(display_order >= 0), is_visible INTEGER NOT NULL DEFAULT 0 CHECK(is_visible IN (0,1)));
CREATE TABLE article_translations (article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE, locale TEXT NOT NULL CHECK(locale IN ('en','fr','ar')), title TEXT NOT NULL, excerpt TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(article_id, locale));
CREATE TABLE site_settings (id INTEGER PRIMARY KEY CHECK(id = 1), brand_name TEXT NOT NULL, contact_enabled INTEGER NOT NULL DEFAULT 0 CHECK(contact_enabled IN (0,1)), default_locale TEXT NOT NULL DEFAULT 'en' CHECK(default_locale = 'en'));
INSERT INTO site_settings(id, brand_name) VALUES (1, 'mohamedeghboudj');
CREATE TABLE site_setting_translations (settings_id INTEGER NOT NULL REFERENCES site_settings(id) ON DELETE CASCADE, locale TEXT NOT NULL CHECK(locale IN ('en','fr','ar')), availability TEXT NOT NULL DEFAULT '', footer_text TEXT NOT NULL DEFAULT '', PRIMARY KEY(settings_id, locale));
CREATE TABLE seo_settings (id INTEGER PRIMARY KEY CHECK(id = 1), social_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL);
INSERT INTO seo_settings(id) VALUES(1);
CREATE TABLE seo_translations (settings_id INTEGER NOT NULL REFERENCES seo_settings(id) ON DELETE CASCADE, locale TEXT NOT NULL CHECK(locale IN ('en','fr','ar')), title TEXT NOT NULL, description TEXT NOT NULL, PRIMARY KEY(settings_id, locale));
CREATE TABLE social_links (id INTEGER PRIMARY KEY, platform TEXT NOT NULL, url TEXT NOT NULL, display_order INTEGER NOT NULL DEFAULT 0 CHECK(display_order >= 0), is_visible INTEGER NOT NULL DEFAULT 0 CHECK(is_visible IN (0,1)));
CREATE TABLE social_link_translations (link_id INTEGER NOT NULL REFERENCES social_links(id) ON DELETE CASCADE, locale TEXT NOT NULL CHECK(locale IN ('en','fr','ar')), label TEXT NOT NULL, PRIMARY KEY(link_id, locale));
