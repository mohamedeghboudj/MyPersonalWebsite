ALTER TABLE contact_messages ADD COLUMN subject TEXT NOT NULL DEFAULT '';
ALTER TABLE contact_messages ADD COLUMN starred INTEGER NOT NULL DEFAULT 0 CHECK(starred IN (0,1));
ALTER TABLE contact_messages ADD COLUMN private_note TEXT NOT NULL DEFAULT '';
CREATE INDEX contact_status_created ON contact_messages(status, created_at);
CREATE INDEX contact_starred_created ON contact_messages(starred, created_at);
